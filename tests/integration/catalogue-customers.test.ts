import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { getProduct, listProducts, updateProduct } from "@/server/modules/catalogue/service";
import { createCustomer, listCustomers, updateCustomer } from "@/server/modules/customers/service";
import {
  createPriceList,
  getDefaultPriceListId,
  resolvePrice,
  savePrices,
  setDefaultPriceList,
  updatePriceList,
} from "@/server/modules/pricing/service";
import { createSupplier } from "@/server/modules/suppliers/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";
import { makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

describe("products", () => {
  it("creates a product with default-list prices; SKU and barcode stay unique", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner, {
      sku: "wrg-x1",
      barcode: "6001234567890",
      costPrice: "4.50",
      prices: { PIECE: "10", PACK: "95.50", CARTON: "" },
    });
    expect(p.sku).toBe("WRG-X1");
    const detail = await getProduct(db, owner, p.id);
    expect(detail.product.costPrice).toBe("4.50");
    expect(detail.prices.map((x) => [x.unit, x.price]).sort()).toEqual([
      ["PACK", "95.50"],
      ["PIECE", "10.00"],
    ]);
    await expect(makeProduct(db, owner, { sku: "WRG-X1" })).rejects.toThrow(ValidationError);
    await expect(makeProduct(db, owner, { barcode: "6001234567890" })).rejects.toThrow(ValidationError);
  });

  it("hides cost prices from sales staff and keeps them when others edit", async () => {
    const owner = await makeUser(db, "OWNER");
    const sales = await makeUser(db, "SALES");
    const p = await makeProduct(db, owner, { costPrice: "3.20" });
    const list = await listProducts(db, sales);
    expect(list[0]?.costPrice).toBeNull();
    await expect(updateProduct(db, sales, p.id, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("detects two people editing the same product", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const form = {
      sku: p.sku,
      name: "Renamed",
      brand: "B",
      category: "C",
      unitsPerPack: 10,
      packsPerCarton: 20,
      version: 1,
    };
    await updateProduct(db, owner, p.id, form);
    await expect(updateProduct(db, owner, p.id, { ...form, name: "Other" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("pricing", () => {
  it("customer price list first, then the default list", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner, { prices: { PIECE: "10", PACK: "", CARTON: "1800" } });
    const wholesale = await createPriceList(db, owner, {
      code: "wholesale",
      name: "Wholesale",
      pricesIncludeTax: "on",
    });
    await savePrices(db, owner, wholesale.id, [{ productId: p.id, unit: "CARTON", price: "1700" }]);
    const shop = await createCustomer(db, owner, { name: "Shop A", priceListId: wholesale.id });

    expect((await resolvePrice(db, { productId: p.id, unit: "CARTON", customerId: shop.id }))?.price).toBe(
      "1700.00",
    );
    expect((await resolvePrice(db, { productId: p.id, unit: "PIECE", customerId: shop.id }))?.price).toBe(
      "10.00",
    );
    expect((await resolvePrice(db, { productId: p.id, unit: "CARTON" }))?.price).toBe("1800.00");
    expect(await resolvePrice(db, { productId: p.id, unit: "PACK" })).toBeNull();
  });

  it("only real price changes are written and audited; blanks remove a price", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner, { prices: { PIECE: "10", PACK: "", CARTON: "" } });
    const listId = (await getDefaultPriceListId(db))!;
    const before = await db.auditLog.count({ where: { action: "PRICES_CHANGED" } });
    expect(await savePrices(db, owner, listId, [{ productId: p.id, unit: "PIECE", price: "10.00" }])).toBe(0);
    expect(await savePrices(db, owner, listId, [{ productId: p.id, unit: "PIECE", price: "" }])).toBe(1);
    expect(await db.priceListItem.count({ where: { productId: p.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "PRICES_CHANGED" } })).toBe(before + 1);
  });

  it("only owners and admins change prices; the default list can't be deactivated", async () => {
    const owner = await makeUser(db, "OWNER");
    const acct = await makeUser(db, "ACCOUNTANT");
    const listId = (await getDefaultPriceListId(db))!;
    await expect(savePrices(db, acct, listId, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updatePriceList(db, owner, listId, { name: "Standard", status: "INACTIVE" }),
    ).rejects.toThrow(/default price list/);
    const other = await createPriceList(db, owner, { code: "B", name: "B" });
    await setDefaultPriceList(db, owner, other.id);
    expect(await getDefaultPriceListId(db)).toBe(other.id);
  });
});

describe("customers", () => {
  it("assigns account numbers, cleans phone numbers and refuses placeholders", async () => {
    const sales = await makeUser(db, "SALES");
    const c = await createCustomer(db, sales, {
      name: "Mama Mboga Stores",
      phone: "0712 345 678",
      type: "KIOSK",
    });
    expect(c).toMatchObject({ code: "CUS-000001", phone: "254712345678", creditLimit: "0.00" });
    await expect(createCustomer(db, sales, { name: "Shop B", phone: "0700" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await listCustomers(db, sales, { q: "0712345678" })).map((x) => x.code)).toEqual(["CUS-000001"]);
  });

  it("warns about same-name customers (case, spacing and punctuation ignored)", async () => {
    const owner = await makeUser(db, "OWNER");
    await createCustomer(db, owner, { name: "Abdi Wholesalers" });
    const err = await createCustomer(db, owner, { name: "abdi  wholesalers." }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fieldErrors.name?.[0]).toMatch(/CUS-000001/);
    const second = await createCustomer(db, owner, { name: "abdi wholesalers", allowDuplicateName: "on" });
    expect(second.code).toBe("CUS-000002");
  });

  it("credit limits and terms need the credit permission", async () => {
    const sales = await makeUser(db, "SALES");
    const acct = await makeUser(db, "ACCOUNTANT");
    await expect(
      createCustomer(db, sales, { name: "Credit Shop", creditLimit: "50000" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const c = await createCustomer(db, sales, { name: "Credit Shop" });
    // Sales can edit other details…
    const renamed = await updateCustomer(db, sales, c.id, { name: "Credit Shop Ltd", version: 1 });
    expect(renamed.name).toBe("Credit Shop Ltd");
    // …but not credit.
    await expect(
      updateCustomer(db, sales, c.id, { name: "Credit Shop Ltd", creditLimit: "1000", version: 2 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const credited = await updateCustomer(db, acct, c.id, {
      name: "Credit Shop Ltd",
      creditLimit: "75,000.00",
      paymentTermsDays: 30,
      version: 2,
    });
    expect(credited).toMatchObject({ creditLimit: "75000.00", paymentTermsDays: 30 });
  });

  it("KRA PINs are unique across customers", async () => {
    const owner = await makeUser(db, "OWNER");
    await createCustomer(db, owner, { name: "One", kraPin: "P051234567X" });
    await expect(createCustomer(db, owner, { name: "Two", kraPin: "p051234567x" })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe("suppliers", () => {
  it("creates suppliers with SUP- numbers; storekeepers can't", async () => {
    const acct = await makeUser(db, "ACCOUNTANT");
    const store = await makeUser(db, "STOREKEEPER");
    const s = await createSupplier(db, acct, { name: "Wrigley East Africa", paymentTermsDays: 30 });
    expect(s.code).toBe("SUP-000001");
    await expect(createSupplier(db, store, { name: "X" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
