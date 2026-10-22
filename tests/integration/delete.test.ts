import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { effectivePermissions } from "@/server/auth/permissions";
import { ConflictError, ForbiddenError } from "@/server/errors";
import { startAccounting, trialBalance } from "@/server/modules/accounting/service";
import { createCustomer } from "@/server/modules/customers/service";
import {
  customerBalance,
  customerStatement,
  deletePayment,
  getPayment,
  listPayments,
  recordPayment,
  reversePayment,
} from "@/server/modules/payments/service";
import { createCreditNote, creditableLines } from "@/server/modules/sales/credit-notes";
import { deleteInvoice } from "@/server/modules/sales/delete-invoice";
import { listDocuments } from "@/server/modules/sales/queries";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
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

async function setup() {
  const owner = await makeUser(db, "OWNER");
  const admin = await makeUser(db, "ADMIN");
  const sales = await makeUser(db, "SALES");
  const accountant = await makeUser(db, "ACCOUNTANT");
  // 200 pieces a carton, KES 1,900 a carton, costing KES 5 a piece.
  const product = await makeProduct(db, owner, { prices: { CARTON: "1900" }, costPrice: "5" });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 1000);
  await db.inventoryValuation.update({ where: { productId: product.id }, data: { value: "5000.00" } });
  const customer = await createCustomer(db, owner, {
    name: `Customer ${randomUUID().slice(0, 6)}`,
    type: "WHOLESALER",
    creditLimit: "1000000",
    paymentTermsDays: 14,
  });
  return { owner, admin, sales, accountant, product, main, customer };
}
type S = Awaited<ReturnType<typeof setup>>;

async function invoice(s: S, cartons = 1) {
  const { id } = await createDraft(db, s.sales, "INVOICE", {
    customerId: s.customer.id,
    warehouseId: s.main.id,
    issueDate: today(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons }],
  });
  await postInvoice(db, s.sales, id, { version: 1 });
  return db.salesDocument.findUniqueOrThrow({ where: { id } });
}

const pay = (s: S, amount: string, reference = "SJK3H7QW2P") =>
  recordPayment(db, s.sales, {
    customerId: s.customer.id,
    receivedOn: today(),
    method: "MPESA",
    reference,
    amount,
    idempotencyKey: randomUUID(),
  });

async function accounts(s: S) {
  const tb = await trialBalance(db, s.owner);
  const by = (k: string) => tb.rows.find((r) => r.systemKey === k)?.balance ?? "0.00";
  return {
    balanced: tb.balanced,
    AR: by("AR"),
    SALES: by("SALES"),
    VAT: by("VAT_OUTPUT"),
    COGS: by("COGS"),
    INV: by("INVENTORY"),
  };
}

describe("deleting an invoice (owners and admins)", () => {
  it("undoes everything: stock back at cost, ledger reversed, payment becomes credit; hidden but kept", async () => {
    const s = await setup();
    const before = await accounts(s);
    const inv = await invoice(s, 2); // 3,800; 400 pieces out
    await pay(s, "1000");
    expect(await balance(db, s.product.id, s.main.id)).toBe(600);

    const current = await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } });
    const r = await deleteInvoice(db, s.admin, inv.id, { version: current.version, reason: "Entered twice" });
    expect(r).toMatchObject({ number: inv.number, creditFreed: "1000.00", stockReturned: true });

    expect(await balance(db, s.product.id, s.main.id)).toBe(1000);
    expect(
      (await db.inventoryValuation.findUniqueOrThrow({ where: { productId: s.product.id } })).value.toFixed(
        2,
      ),
    ).toBe("5000.00");
    const after = await accounts(s);
    expect(after.balanced).toBe(true);
    // Sales, VAT, cost of sales and stock are back where they were; receivables show the customer's credit.
    expect([after.SALES, after.VAT, after.COGS, after.INV]).toEqual([
      before.SALES,
      before.VAT,
      before.COGS,
      before.INV,
    ]);
    const bal = await customerBalance(db, s.customer.id);
    expect(bal).toMatchObject({ owedOnInvoices: "0.00", unappliedCredit: "1000.00", balance: "-1000.00" });

    const doc = await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } });
    expect(doc).toMatchObject({ status: "CANCELLED", number: inv.number, deletedById: s.admin.id });
    expect(doc.cancelReason).toBe("Deleted: Entered twice");
    expect((await listDocuments(db, s.owner, "INVOICE", { status: "ALL" })).map((d) => d.id)).not.toContain(
      inv.id,
    );
    expect((await listDocuments(db, s.owner, "INVOICE", { status: "DELETED" })).map((d) => d.id)).toEqual([
      inv.id,
    ]);
    const st = await customerStatement(db, s.owner, s.customer.id);
    expect(st.lines.map((l) => l.kind)).toEqual(["Payment"]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "INVOICE_DELETED" } });
    expect(audit.summary).toContain("KES 1,000.00 paid on it is now credit");
    expect(audit.before).toMatchObject({ number: inv.number, total: "3800.00" });

    // Frozen from now on, and never physically removed.
    await expect(db.salesDocument.update({ where: { id: inv.id }, data: { notes: "x" } })).rejects.toThrow(
      /deleted document/,
    );
    await expect(db.salesDocument.delete({ where: { id: inv.id } })).rejects.toThrow();
    await expect(
      deleteInvoice(db, s.owner, inv.id, { version: doc.version, reason: "again" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("goods that aren't coming back stay sold: no stock back, cost of sales kept", async () => {
    const s = await setup();
    const inv = await invoice(s, 1);
    const before = await accounts(s);
    await deleteInvoice(db, s.owner, inv.id, {
      version: inv.version,
      reason: "Wrong customer",
      returnsToStock: "false",
    });
    expect(await balance(db, s.product.id, s.main.id)).toBe(800);
    const after = await accounts(s);
    expect(after.balanced).toBe(true);
    expect([after.COGS, after.INV]).toEqual([before.COGS, before.INV]);
    expect(after.SALES).not.toBe(before.SALES);
  });

  it("drafts can be deleted too; refused with credit notes, for other roles, and can't be granted as a duty", async () => {
    const s = await setup();
    const { id: draft } = await createDraft(db, s.sales, "INVOICE", {
      customerId: s.customer.id,
      warehouseId: s.main.id,
      issueDate: today(),
      lines: [{ productId: s.product.id, unit: "CARTON", quantity: 1 }],
    });
    await deleteInvoice(db, s.owner, draft, { version: 1, reason: "Not needed" });
    expect(await db.salesDocument.findUniqueOrThrow({ where: { id: draft } })).toMatchObject({
      status: "CANCELLED",
      number: null,
    });

    const inv = await invoice(s, 1);
    for (const who of [s.sales, s.accountant]) {
      await expect(
        deleteInvoice(db, who, inv.id, { version: inv.version, reason: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(
      effectivePermissions("ACCOUNTANT", [{ permission: "invoices.delete", granted: true }]),
    ).not.toContain("invoices.delete");
    const lines = await creditableLines(db, s.accountant, inv.id);
    await createCreditNote(db, s.accountant, inv.id, {
      idempotencyKey: randomUUID(),
      reason: "Damaged",
      lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
    });
    const fresh = await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } });
    await expect(
      deleteInvoice(db, s.owner, inv.id, { version: fresh.version, reason: "Mistake" }),
    ).rejects.toThrow(/has credit note CN-/);
  });

  it("an old-system invoice's opening balance comes off the accounts", async () => {
    const s = await setup();
    const hist = await db.salesDocument.create({
      data: {
        kind: "INVOICE",
        customerId: s.customer.id,
        warehouseId: s.main.id,
        issueDate: new Date("2026-09-01T00:00:00Z"),
        createdById: s.owner.id,
        subtotal: "862.07",
        taxTotal: "137.93",
        total: "1000.00",
      },
    });
    const posted = await db.salesDocument.update({
      where: { id: hist.id },
      data: {
        number: "VJL-OLD1",
        status: "POSTED",
        historical: true,
        postedAt: new Date(),
        postedById: s.owner.id,
        amountPaid: "300",
      },
    });
    await startAccounting(db, s.owner);
    expect((await accounts(s)).AR).toBe("700.00");
    await deleteInvoice(db, s.owner, hist.id, {
      version: posted.version,
      reason: "Was cancelled in the old system",
    });
    const after = await accounts(s);
    expect(after).toMatchObject({ balanced: true, AR: "0.00" });
    expect((await customerBalance(db, s.customer.id)).balance).toBe("0.00");
  });
});

describe("deleting a payment (owners and admins)", () => {
  it("reverses it, hides it, and frees its M-Pesa code to be entered again", async () => {
    const s = await setup();
    const inv = await invoice(s, 1);
    const p = await pay(s, "1900");
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid.toFixed(2)).toBe(
      "1900.00",
    );

    await expect(deletePayment(db, s.accountant, p.id, { version: 1, reason: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await deletePayment(db, s.owner, p.id, { version: 1, reason: "Wrong customer" });

    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid.toFixed(2)).toBe(
      "0.00",
    );
    expect((await customerBalance(db, s.customer.id)).balance).toBe("1900.00");
    expect((await accounts(s)).balanced).toBe(true);
    expect((await listPayments(db, s.owner)).map((x) => x.id)).not.toContain(p.id);
    expect((await listPayments(db, s.owner, { deleted: true })).map((x) => x.id)).toEqual([p.id]);
    const gone = await getPayment(db, s.owner, p.id);
    expect(gone).toMatchObject({ status: "REVERSED", reference: `SJK3H7QW2P (deleted ${p.number})` });
    expect((await customerStatement(db, s.owner, s.customer.id)).lines.map((l) => l.kind)).toEqual([
      "Invoice",
    ]);

    // The same code can now be recorded properly.
    const again = await pay(s, "1900");
    expect(again.number).not.toBe(p.number);
    await expect(db.payment.update({ where: { id: p.id }, data: { notes: "x" } })).rejects.toThrow(
      /deleted payment/,
    );
  });

  it("a reversed payment can be deleted (just hidden), once", async () => {
    const s = await setup();
    await invoice(s, 1);
    const p = await pay(s, "500");
    await reversePayment(db, s.accountant, p.id, { version: 1, reason: "Bounced" });
    const before = await trialBalance(db, s.owner);
    await deletePayment(db, s.admin, p.id, { version: 2, reason: "Clean up" });
    expect((await trialBalance(db, s.owner)).rows).toEqual(before.rows);
    await expect(deletePayment(db, s.admin, p.id, { version: 3, reason: "again" })).rejects.toThrow(
      /already deleted/,
    );
  });
});
