import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addDays, todayInNairobi } from "@/lib/dates";
import { ForbiddenError } from "@/server/errors";
import { createCustomer } from "@/server/modules/customers/service";
import { recordPayment } from "@/server/modules/payments/service";
import { dashboard, myDashboard } from "@/server/modules/reports/service";
import { createCreditNote, creditableLines } from "@/server/modules/sales/credit-notes";
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

const today = () => todayInNairobi();

describe("a salesperson's own dashboard", () => {
  it("counts only their own invoices, credit notes on them and money they recorded", async () => {
    const owner = await makeUser(db, "OWNER");
    const amina = await makeUser(db, "SALES");
    const brian = await makeUser(db, "SALES");
    const accountant = await makeUser(db, "ACCOUNTANT");
    const product = await makeProduct(db, owner, { prices: { PACK: "100", CARTON: "1900" } });
    const main = await mainWarehouse(db);
    await addStock(db, owner, product.id, main.id, 4000);
    const customer = await createCustomer(db, owner, {
      name: `Customer ${randomUUID().slice(0, 6)}`,
      type: "WHOLESALER",
      creditLimit: "1000000",
    });

    const sell = async (who: typeof amina, cartons: number) => {
      const { id } = await createDraft(db, who, "INVOICE", {
        customerId: customer.id,
        warehouseId: main.id,
        issueDate: today(),
        lines: [{ productId: product.id, unit: "CARTON", quantity: cartons }],
      });
      await postInvoice(db, who, id, { version: 1 });
      return id;
    };
    const aminaInv = await sell(amina, 2); // 3,800
    await sell(amina, 1); // 1,900
    await sell(brian, 5); // 9,500: Brian's, not Amina's

    // One carton of Amina's first invoice comes back.
    const lines = await creditableLines(db, accountant, aminaInv);
    await createCreditNote(db, accountant, aminaInv, {
      idempotencyKey: randomUUID(),
      reason: "Returned",
      lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
    });
    await recordPayment(db, amina, {
      customerId: customer.id,
      receivedOn: today(),
      method: "CASH",
      amount: "1000",
      idempotencyKey: randomUUID(),
    });
    // A draft quotation and a draft invoice of Amina's, still open.
    await createDraft(db, amina, "QUOTATION", {
      customerId: customer.id,
      warehouseId: main.id,
      issueDate: today(),
      lines: [{ productId: product.id, unit: "CARTON", quantity: 3 }],
    });
    await createDraft(db, amina, "INVOICE", {
      customerId: customer.id,
      warehouseId: main.id,
      issueDate: today(),
      lines: [{ productId: product.id, unit: "PACK", quantity: 1 }],
    });

    const d = await myDashboard(db, amina);
    expect(d.todaySales).toEqual({ invoices: 2, netGross: "3800.00" }); // 3,800 + 1,900 − 1,900
    expect(d.monthSales.netGross).toBe("3800.00");
    expect(d.monthReceived).toBe("1000.00");
    expect(d.paymentsRecorded).toBe(1);
    expect(d.open).toMatchObject({ quotes: 1, quotesValue: "5700.00", draftInvoices: 1 });
    expect(d.trend.at(-1)).toEqual({ day: today(), sales: "3800.00", received: "1000.00" });
    expect(d.topCustomers).toEqual([
      expect.objectContaining({ id: customer.id, gross: "5700.00", invoices: 2 }),
    ]);
    expect(d.toChase).toEqual([]);

    const b = await myDashboard(db, brian);
    expect(b.todaySales).toEqual({ invoices: 1, netGross: "9500.00" });
    expect(b.monthReceived).toBe("0.00");
  });

  it("lists their customers' overdue invoices, oldest first", async () => {
    const owner = await makeUser(db, "OWNER");
    const amina = await makeUser(db, "SALES");
    const product = await makeProduct(db, owner, { prices: { PACK: "100", CARTON: "1900" } });
    const main = await mainWarehouse(db);
    await addStock(db, owner, product.id, main.id, 4000);
    const customer = await createCustomer(db, owner, {
      name: "Mama Pima",
      type: "WHOLESALER",
      creditLimit: "1000000",
    });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { id } = await createDraft(db, amina, "INVOICE", {
        customerId: customer.id,
        warehouseId: main.id,
        issueDate: today(),
        lines: [{ productId: product.id, unit: "CARTON", quantity: 1 }],
      });
      await postInvoice(db, amina, id, { version: 1 });
      ids.push(id);
    }
    // Posted invoices can't be edited, so move their dates back with triggers off (test only).
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRaw`UPDATE sales_documents SET issue_date = ${new Date(`${addDays(today(), -10)}T00:00:00Z`)}, due_date = ${new Date(`${addDays(today(), -10)}T00:00:00Z`)} WHERE id = ${ids[0]}::uuid`;
      await tx.$executeRaw`UPDATE sales_documents SET issue_date = ${new Date(`${addDays(today(), -40)}T00:00:00Z`)}, due_date = ${new Date(`${addDays(today(), -40)}T00:00:00Z`)} WHERE id = ${ids[1]}::uuid`;
    });
    const d = await myDashboard(db, amina);
    expect(d.toChase.map((c) => [c.id, c.daysOverdue, c.balance])).toEqual([
      [ids[1], 40, "1900.00"],
      [ids[0], 10, "1900.00"],
    ]);
    expect(d).toMatchObject({ overdueCount: 2, overdueTotal: "3800.00" });
  });

  it("needs the own-dashboard duty; the business dashboard stays with managers", async () => {
    const store = await makeUser(db, "STOREKEEPER");
    const sales = await makeUser(db, "SALES");
    await expect(myDashboard(db, store)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dashboard(db, sales)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(myDashboard(db, sales)).resolves.toMatchObject({ todaySales: { invoices: 0 } });
  });
});
