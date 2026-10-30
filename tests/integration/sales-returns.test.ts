import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { createCustomer } from "@/server/modules/customers/service";
import { deleteCreditNote } from "@/server/modules/sales/correct-credit-note";
import { createCreditNote, creditableLines } from "@/server/modules/sales/credit-notes";
import { salesReturns } from "@/server/modules/sales/returns";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

describe("sales returns", () => {
  it("lists only issued credit notes whose goods came back into stock", async () => {
    const today = todayInNairobi();
    const owner = await makeUser(db, "OWNER");
    const product = await makeProduct(db, owner, { prices: { CARTON: "1900" }, costPrice: "5" });
    const main = await mainWarehouse(db);
    await addStock(db, owner, product.id, main.id, 1000);
    const customer = await createCustomer(db, owner, {
      name: "Returns Shop",
      type: "WHOLESALER",
      creditLimit: "100000",
      paymentTermsDays: 14,
    });
    const { id } = await createDraft(db, owner, "INVOICE", {
      customerId: customer.id,
      warehouseId: main.id,
      issueDate: today,
      lines: [{ productId: product.id, unit: "CARTON", quantity: 3 }],
    });
    await postInvoice(db, owner, id, { version: 1 });
    const line = (await creditableLines(db, owner, id)).lines[0]!.id;
    const credit = (returnsToStock: boolean) =>
      createCreditNote(db, owner, id, {
        idempotencyKey: randomUUID(),
        reason: returnsToStock ? "Came back unopened" : "Price adjustment",
        returnsToStock: returnsToStock ? "on" : undefined,
        lines: [{ lineId: line, quantity: 1 }],
      });
    const back = await credit(true);
    await credit(false); // money only: not a return
    const gone = await credit(true);
    const v = (await db.salesDocument.findUniqueOrThrow({ where: { id: gone.id } })).version;
    await deleteCreditNote(db, owner, gone.id, { version: v, why: "Entered twice" });

    const r = await salesReturns(db, owner, { from: today, to: today });
    expect(r.rows.map((x) => x.number)).toEqual([back.number]);
    expect(r).toMatchObject({ count: 1, pieces: 200, value: "1900.00" });
    expect(r.rows[0]).toMatchObject({ reason: "Came back unopened", warehouse: main.name });
    expect(r.byProduct).toHaveLength(1);
  });
});
