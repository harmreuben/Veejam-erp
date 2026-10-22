import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { createCustomer } from "@/server/modules/customers/service";
import { createAndPostInvoice, invoiceAndPost, postInvoiceBatch } from "@/server/modules/sales/quick-post";
import { confirmOrder, createDraft } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, balance, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

const today = () => todayInNairobi();

// A carton is 200 pieces; 400 pieces in stock = 2 cartons.
async function setup(opts: { creditLimit?: string } = {}) {
  const owner = await makeUser(db, "OWNER");
  const sales = await makeUser(db, "SALES");
  const product = await makeProduct(db, owner, { prices: { PIECE: "10", PACK: "95", CARTON: "1900" } });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 400);
  const customer = (name: string, creditLimit = opts.creditLimit ?? "100000") =>
    createCustomer(db, owner, { name, type: "WHOLESALER", creditLimit, paymentTermsDays: 14 });
  const mama = await customer(`Mama Pima ${randomUUID().slice(0, 4)}`);
  const duka = await customer(`Duka Bora ${randomUUID().slice(0, 4)}`);
  return { owner, sales, product, main, mama, duka };
}
type S = Awaited<ReturnType<typeof setup>>;

const input = (s: S, customerId: string, cartons: number) => ({
  customerId,
  warehouseId: s.main.id,
  issueDate: today(),
  lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons }],
});

describe("an invoice posts as soon as it's written", () => {
  it("numbers it, takes the stock out, and a second submit of the same form posts nothing more", async () => {
    const s = await setup();
    const key = randomUUID();
    const r = await createAndPostInvoice(db, s.sales, input(s, s.mama.id, 1), {}, { idempotencyKey: key });
    expect(r).toMatchObject({ posted: true, number: "INV-000001", problem: null, total: "1900.00" });
    expect(await balance(db, s.product.id, s.main.id)).toBe(200);

    const again = await createAndPostInvoice(
      db,
      s.sales,
      input(s, s.mama.id, 1),
      {},
      { idempotencyKey: key },
    );
    expect(again).toMatchObject({ id: r.id, posted: true, number: "INV-000001" });
    expect(await db.salesDocument.count({ where: { kind: "INVOICE" } })).toBe(1);
    expect(await balance(db, s.product.id, s.main.id)).toBe(200);
  });

  it("keeps a draft with the reason when stock or credit stop it, and uses no number", async () => {
    const s = await setup();
    const short = await createAndPostInvoice(db, s.sales, input(s, s.mama.id, 3));
    expect(short).toMatchObject({ posted: false, number: null });
    expect(short.problem).toMatch(/^Not enough stock/);
    expect(short.problem).not.toContain("Nothing was changed");
    expect(await db.salesDocument.findUniqueOrThrow({ where: { id: short.id } })).toMatchObject({
      status: "DRAFT",
      number: null,
    });

    const tight = await createCustomer(db, s.owner, {
      name: "Tight Credit",
      type: "WHOLESALER",
      creditLimit: "1000",
      paymentTermsDays: 14,
    });
    const credit = await createAndPostInvoice(db, s.sales, input(s, tight.id, 1));
    expect(credit).toMatchObject({ posted: false });
    expect(credit.problem).toContain("Credit check failed");

    // The next invoice that does post still gets the first number.
    expect((await createAndPostInvoice(db, s.sales, input(s, s.mama.id, 1))).number).toBe("INV-000001");
  });

  it("form mistakes are refused before anything is saved; storekeepers can't post", async () => {
    const s = await setup();
    await expect(
      createAndPostInvoice(db, s.sales, { ...input(s, s.mama.id, 1), customerId: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.salesDocument.count()).toBe(0);
    const store = await makeUser(db, "STOREKEEPER");
    await expect(createAndPostInvoice(db, store, input(s, s.mama.id, 1))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("a confirmed order is invoiced and posted in one step", async () => {
    const s = await setup();
    const order = await createDraft(db, s.sales, "SALES_ORDER", input(s, s.mama.id, 1));
    await confirmOrder(db, s.sales, order.id, { version: 1 });
    const r = await invoiceAndPost(db, s.sales, order.id);
    expect(r).toMatchObject({ posted: true, number: "INV-000001" });
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("INVOICED");
    expect(await db.stockReservation.count()).toBe(0);
    // Pressing it again opens the same invoice.
    expect((await invoiceAndPost(db, s.sales, order.id)).id).toBe(r.id);
  });
});

describe("a batch of invoices from one screen", () => {
  it("posts each one in order, keeps the ones that can't post as drafts, and reports bad ones without stopping", async () => {
    const s = await setup();
    const batchKey = randomUUID();
    const form = {
      warehouseId: s.main.id,
      issueDate: today(),
      batchKey,
      invoices: [
        { customerId: s.mama.id, lines: [{ productId: s.product.id, unit: "CARTON", quantity: "1" }] },
        // An empty card is ignored.
        { customerId: "", lines: [{ productId: "", unit: "CARTON", quantity: "" }] },
        {
          customerId: s.duka.id,
          customerReference: "LPO-77",
          lines: [{ productId: s.product.id, unit: "PACK", quantity: "5" }],
        },
        // Only one carton's worth is left by now (200 − 50 pieces): this one waits as a draft.
        { customerId: s.mama.id, lines: [{ productId: s.product.id, unit: "CARTON", quantity: "1" }] },
        // No customer: not saved at all.
        { customerId: "", lines: [{ productId: s.product.id, unit: "CARTON", quantity: "1" }] },
      ],
    };
    const results = await postInvoiceBatch(db, s.sales, form);
    expect(results.map((r) => [r.index, r.posted, r.posted ? r.number : null])).toEqual([
      [0, true, "INV-000001"],
      [2, true, "INV-000002"],
      [3, false, null],
      [4, false, null],
    ]);
    expect(results[2]!.id).toBeTruthy();
    expect(results[2]!.problem).toMatch(/Not enough stock/);
    expect(results[3]).toMatchObject({ id: null });
    expect(results[3]!.problem).toBeTruthy();
    expect(await balance(db, s.product.id, s.main.id)).toBe(150);
    const lpo = await db.salesDocument.findFirstOrThrow({ where: { number: "INV-000002" } });
    expect(lpo.customerReference).toBe("LPO-77");

    // Submitting the same batch again posts nothing twice.
    const again = await postInvoiceBatch(db, s.sales, form);
    expect(again.filter((r) => r.posted).map((r) => r.posted && r.number)).toEqual([
      "INV-000001",
      "INV-000002",
    ]);
    expect(await db.salesDocument.count({ where: { kind: "INVOICE" } })).toBe(3);
    expect(await balance(db, s.product.id, s.main.id)).toBe(150);
  });

  it("needs at least one invoice, and the right to post", async () => {
    const s = await setup();
    await expect(
      postInvoiceBatch(db, s.sales, {
        warehouseId: s.main.id,
        issueDate: today(),
        batchKey: randomUUID(),
        invoices: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const store = await makeUser(db, "STOREKEEPER");
    await expect(
      postInvoiceBatch(db, store, {
        warehouseId: s.main.id,
        issueDate: today(),
        batchKey: randomUUID(),
        invoices: [{ customerId: s.mama.id, lines: [] }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
