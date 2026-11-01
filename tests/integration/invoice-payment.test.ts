import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { ValidationError } from "@/server/errors";
import { invoicePaymentInput } from "@/server/modules/payments/invoice-payment";
import { customerBalance, recordPayment } from "@/server/modules/payments/service";
import { createCustomer } from "@/server/modules/customers/service";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, mainWarehouse, makeProduct } from "./phase3-helpers";

// Recording a payment from an invoice's own page with one short form.

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

async function setup() {
  const owner = await makeUser(db, "OWNER");
  const product = await makeProduct(db, owner, { prices: { PACK: "100", CARTON: "1900" } });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 4000);
  const customer = await createCustomer(db, owner, {
    name: `Customer ${randomUUID().slice(0, 6)}`,
    type: "WHOLESALER",
    creditLimit: "1000000",
  });
  const invoice = async (cartons: number) => {
    const { id } = await createDraft(db, owner, "INVOICE", {
      customerId: customer.id,
      warehouseId: main.id,
      issueDate: todayInNairobi(),
      lines: [{ productId: product.id, unit: "CARTON", quantity: cartons }],
    });
    await postInvoice(db, owner, id, { version: 1 });
    return db.salesDocument.findUniqueOrThrow({ where: { id } });
  };
  return { owner, customer, invoice };
}

const form = (amount: string, extra: Record<string, unknown> = {}) => ({
  amount,
  method: "MPESA",
  reference: "sjk3h7qw2p",
  receivedOn: todayInNairobi(),
  idempotencyKey: randomUUID(),
  ...extra,
});

describe("record a payment from an invoice", () => {
  it("pays the invoice it was recorded on, not the oldest one, and posts to M-Pesa", async () => {
    const s = await setup();
    const older = await s.invoice(1);
    const newer = await s.invoice(2);
    const part = "1000.00";
    const r = await recordPayment(db, s.owner, await invoicePaymentInput(db, newer.id, form(part)));

    const after = await db.salesDocument.findUniqueOrThrow({ where: { id: newer.id } });
    expect(after.amountPaid.toFixed(2)).toBe(part);
    expect(
      (await db.salesDocument.findUniqueOrThrow({ where: { id: older.id } })).amountPaid.toFixed(2),
    ).toBe("0.00");
    const payment = await db.payment.findUniqueOrThrow({ where: { id: r.id } });
    expect(payment.method).toBe("MPESA");
    expect(payment.reference).toBe("SJK3H7QW2P");
    const entry = await db.journalEntry.findFirstOrThrow({
      where: { sourceType: "Payment", sourceId: r.id },
      include: { lines: { include: { account: true } } },
    });
    const debit = entry.lines.find((l) => !l.debit.isZero())!;
    expect(debit.account.code).toBe("1010");
    expect(debit.debit.toFixed(2)).toBe(part);
  });

  it("pays the invoice in full and keeps anything over as credit", async () => {
    const s = await setup();
    const inv = await s.invoice(1);
    const over = inv.total.plus(500).toFixed(2);
    await recordPayment(
      db,
      s.owner,
      await invoicePaymentInput(db, inv.id, form(over, { method: "CASH", reference: "" })),
    );
    const after = await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.amountPaid.toFixed(2)).toBe(inv.total.toFixed(2));
    expect((await customerBalance(db, s.customer.id)).unappliedCredit).toBe("500.00");
  });

  it("refuses a fully paid invoice, and still checks the M-Pesa code", async () => {
    const s = await setup();
    const inv = await s.invoice(1);
    await expect(
      recordPayment(db, s.owner, await invoicePaymentInput(db, inv.id, form("100", { reference: "abc" }))),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordPayment(db, s.owner, await invoicePaymentInput(db, inv.id, form(inv.total.toFixed(2))));
    await expect(invoicePaymentInput(db, inv.id, form("1"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("the same form sent twice records one payment", async () => {
    const s = await setup();
    const inv = await s.invoice(1);
    const once = form("300");
    const a = await recordPayment(db, s.owner, await invoicePaymentInput(db, inv.id, once));
    const b = await recordPayment(db, s.owner, await invoicePaymentInput(db, inv.id, once));
    expect(b).toMatchObject({ id: a.id, alreadyRecorded: true });
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid.toFixed(2)).toBe(
      "300.00",
    );
  });
});
