import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createCustomer } from "@/server/modules/customers/service";
import { cancelImport, commitImport, getImport, validateImport } from "@/server/modules/imports/service";
import { getDefaultPriceListId } from "@/server/modules/pricing/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

const csv = (s: string) => Buffer.from(s.replace(/^\n/, ""));

const PRODUCTS = csv(`
SKU,Name,Brand,Category,Units per pack,Packs per carton,price_piece,price_carton
TST-001,Test Mint 10s,TestBrand,Gum,10,20,10,1900
TST-002,Test Fruit 50s,TestBrand,Gum,50,12,,
`);

describe("product import", () => {
  it("validates, previews, then creates products and default-list prices in one go", async () => {
    const owner = await makeUser(db, "OWNER");
    const job = await validateImport(db, owner, "PRODUCTS", "products.csv", PRODUCTS);
    expect(job).toMatchObject({ totalRows: 2, errorRows: 0, status: "VALIDATED" });
    expect(await db.product.count()).toBe(0); // nothing written yet

    const summary = await commitImport(db, owner, job.id);
    expect(summary).toEqual({ created: 2, updated: 0, unchanged: 0 });
    const listId = (await getDefaultPriceListId(db))!;
    const prices = await db.priceListItem.findMany({
      where: { priceListId: listId },
      orderBy: { unit: "asc" },
    });
    expect(prices.map((p) => [p.unit, p.price.toFixed(2)])).toEqual([
      ["PIECE", "10.00"],
      ["CARTON", "1900.00"],
    ]);
    await expect(commitImport(db, owner, job.id)).rejects.toThrow(/already committed/);

    // Re-importing with a changed price updates instead of duplicating.
    const again = await validateImport(
      db,
      owner,
      "PRODUCTS",
      "products-v2.csv",
      csv(
        "sku,name,brand,category,units_per_pack,packs_per_carton,price_piece\nTST-001,Test Mint 10s,TestBrand,Gum,10,20,12\n",
      ),
    );
    expect(await commitImport(db, owner, again.id)).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect(await db.product.count()).toBe(2);
  });

  it("reports every problem per row and refuses to commit a file with errors", async () => {
    const owner = await makeUser(db, "OWNER");
    const job = await validateImport(
      db,
      owner,
      "PRODUCTS",
      "bad.csv",
      csv(`
sku,name,brand,category,units_per_pack,packs_per_carton,cost_price,tax_category
TST-1,Good,B,C,10,20,4.50,
TST-1,Duplicate,B,C,10,20,,
TST-3,,B,C,0,20,abc,LUXURY
`),
    );
    expect(job.errorRows).toBe(2);
    const detail = await getImport(db, owner, job.id);
    expect(detail.rows[1]!.errors).toContain("sku: TST-1 also appears on row 2");
    const row4 = detail.rows[2]!.errors.join(" | ");
    expect(row4).toMatch(/name:/);
    expect(row4).toMatch(/units_per_pack: At least 1/);
    expect(row4).toMatch(/cost_price:/);
    expect(row4).toMatch(/tax_category:/);
    await expect(commitImport(db, owner, job.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.product.count()).toBe(0);
  });

  it("rejects files with wrong or missing columns before reading rows", async () => {
    const owner = await makeUser(db, "OWNER");
    const err = await validateImport(db, owner, "PRODUCTS", "x.csv", csv("sku,nmae\nA,B\n")).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ValidationError);
    const msgs = (err as ValidationError).fieldErrors.file!.join(" ");
    expect(msgs).toMatch(/Missing required column\(s\): name, brand/);
    expect(msgs).toMatch(/Unrecognised column\(s\): nmae/);
    await expect(validateImport(db, owner, "PRODUCTS", "x.xlsx", PRODUCTS)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("only owners and admins can import", async () => {
    const acct = await makeUser(db, "ACCOUNTANT");
    await expect(validateImport(db, acct, "PRODUCTS", "p.csv", PRODUCTS)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("customer import", () => {
  it("creates new customers, updates by code, and blocks old-system style duplicates and placeholders", async () => {
    const owner = await makeUser(db, "OWNER");
    const existing = await createCustomer(db, owner, { name: "Abdi Wholesalers" });
    const job = await validateImport(
      db,
      owner,
      "CUSTOMERS",
      "customers.csv",
      csv(`
code,name,type,phone,credit_limit,payment_terms_days
,New Kiosk,Kiosk,0712345678,,
${existing.code},Abdi Wholesalers,Wholesaler,0723456789,50000,30
,Abdi wholesalers,,0700,,
`),
    );
    const detail = await getImport(db, owner, job.id);
    expect(detail.rows.map((r) => r.action)).toEqual(["CREATE", "UPDATE", null]);
    expect(detail.rows[2]!.errors.join(" ")).toMatch(/phone:.*real Kenyan number/);
    expect(detail.rows[2]!.errors.join(" ")).toMatch(/name: already exists as CUS-000001/);
    await cancelImport(db, owner, job.id);

    const fixed = await validateImport(
      db,
      owner,
      "CUSTOMERS",
      "customers-fixed.csv",
      csv(`
code,name,type,phone,credit_limit,payment_terms_days
,New Kiosk,Kiosk,0712345678,,
${existing.code},Abdi Wholesalers,Wholesaler,0723456789,50000,30
`),
    );
    expect(await commitImport(db, owner, fixed.id)).toEqual({ created: 1, updated: 1, unchanged: 0 });
    const abdi = await db.customer.findUniqueOrThrow({ where: { id: existing.id } });
    expect(abdi.creditLimit.toFixed(2)).toBe("50000.00");
    expect(abdi.type).toBe("WHOLESALER");
    expect(await db.customer.count()).toBe(2);
  });

  it("re-checks at commit time: data changed after the preview is caught", async () => {
    const owner = await makeUser(db, "OWNER");
    const job = await validateImport(
      db,
      owner,
      "CUSTOMERS",
      "c.csv",
      csv("name,kra_pin\nNew Shop,P051234567X\n"),
    );
    expect(job.errorRows).toBe(0);
    await createCustomer(db, owner, { name: "Someone Else", kraPin: "P051234567X" });
    await expect(commitImport(db, owner, job.id)).rejects.toThrow(/data changed since this file was checked/);
    expect(await db.customer.count()).toBe(1);
  });
});
