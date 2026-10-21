import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addDays, todayInNairobi } from "@/lib/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import {
  closeBooks,
  postManualJournal,
  startAccounting,
  trialBalance,
} from "@/server/modules/accounting/service";
import { createCustomer } from "@/server/modules/customers/service";
import {
  agedReceivables,
  applyCredit,
  customerBalance,
  customerStatement,
  recordPayment,
  reversePayment,
} from "@/server/modules/payments/service";
import { createCreditNote, creditableLines } from "@/server/modules/sales/credit-notes";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";

import { clearTestData, rawQuery } from "./db";
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
  const sales = await makeUser(db, "SALES");
  const accountant = await makeUser(db, "ACCOUNTANT");
  const product = await makeProduct(db, owner, { prices: { PACK: "100", CARTON: "1900" } });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 4000);
  const customer = await createCustomer(db, owner, {
    name: `Customer ${randomUUID().slice(0, 6)}`,
    type: "WHOLESALER",
    creditLimit: "1000000",
  });
  return { owner, sales, accountant, product, main, customer };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function invoice(s: Setup, cartons = 1) {
  const { id } = await createDraft(db, s.owner, "INVOICE", {
    customerId: s.customer.id,
    warehouseId: s.main.id,
    issueDate: today(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons }],
  });
  await postInvoice(db, s.owner, id, { version: 1 });
  return db.salesDocument.findUniqueOrThrow({ where: { id } });
}

const pay = (s: Setup, amount: string, extra: Record<string, unknown> = {}) =>
  recordPayment(db, s.sales, {
    customerId: s.customer.id,
    receivedOn: today(),
    method: "CASH",
    amount,
    idempotencyKey: randomUUID(),
    ...extra,
  });

async function accountBalance(key: string) {
  const tb = await trialBalance(db, (await db.user.findFirstOrThrow({ where: { role: "OWNER" } })) as never);
  return tb.rows.find((r) => r.systemKey === key)!.balance;
}

describe("chart of accounts and invoice postings", () => {
  it("seeds the accounts once, and every posted invoice is journalled Dr receivables, Cr sales and VAT", async () => {
    expect(await db.account.count()).toBeGreaterThanOrEqual(20);
    expect((await applySeed(db)).accountsCreated).toBe(0);
    const s = await setup();
    const inv = await invoice(s);
    const entry = await db.journalEntry.findFirstOrThrow({
      where: { sourceType: "Invoice", sourceId: inv.id },
      include: { lines: { include: { account: true } } },
    });
    const byKey = Object.fromEntries(
      entry.lines.map((l) => [l.account.systemKey, [l.debit.toFixed(2), l.credit.toFixed(2)]]),
    );
    expect(byKey).toEqual({
      AR: ["1900.00", "0.00"],
      SALES: ["0.00", "1637.93"],
      VAT_OUTPUT: ["0.00", "262.07"],
    });
    const tb = await trialBalance(db, s.owner);
    expect(tb.balanced).toBe(true);
  });

  it("the database refuses unbalanced or edited journal entries", async () => {
    const s = await setup();
    await invoice(s);
    await expect(rawQuery("UPDATE journal_lines SET debit = 1 WHERE debit > 0")).rejects.toThrow(
      /append-only/,
    );
    await expect(rawQuery("DELETE FROM journal_entries")).rejects.toThrow(/append-only/);
    const acct = await db.account.findFirstOrThrow({ where: { systemKey: "CASH" } });
    await expect(
      rawQuery(`BEGIN;
        INSERT INTO journal_entries (id, number, date, description, source_type, created_by_id)
          VALUES ('00000000-0000-4000-8000-0000000000aa', 'JE-X', CURRENT_DATE, 'x', 'Manual', '${s.owner.id}');
        INSERT INTO journal_lines (entry_id, account_id, debit) VALUES ('00000000-0000-4000-8000-0000000000aa', '${acct.id}', 5);
        INSERT INTO journal_lines (entry_id, account_id, credit) VALUES ('00000000-0000-4000-8000-0000000000aa', '${acct.id}', 4);
        COMMIT;`),
    ).rejects.toThrow(/does not balance/);
    await rawQuery("ROLLBACK").catch(() => undefined);
  });
});

describe("payments", () => {
  it("applies to the oldest invoices first, keeps the rest as credit, and posts Dr cash, Cr receivables", async () => {
    const s = await setup();
    const first = await invoice(s, 1); // 1,900
    const second = await invoice(s, 1); // 1,900
    const r = await pay(s, "2500");
    expect(r.number).toBe("RCT-000001");
    const [a, b] = await Promise.all([
      db.salesDocument.findUniqueOrThrow({ where: { id: first.id } }),
      db.salesDocument.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    expect([a.amountPaid.toFixed(2), b.amountPaid.toFixed(2)]).toEqual(["1900.00", "600.00"]);
    expect(await customerBalance(db, s.customer.id)).toEqual({
      owedOnInvoices: "1300.00",
      unappliedCredit: "0.00",
      balance: "1300.00",
    });
    // Overpayment: 2,000 against 1,300 owed leaves 700 credit.
    await pay(s, "2000");
    expect(await customerBalance(db, s.customer.id)).toEqual({
      owedOnInvoices: "0.00",
      unappliedCredit: "700.00",
      balance: "-700.00",
    });
    expect(await accountBalance("CASH")).toBe("4500.00");
    expect(await accountBalance("AR")).toBe("-700.00");
  });

  it("the same form twice records once; the same M-Pesa code can't be used twice", async () => {
    const s = await setup();
    await invoice(s);
    const key = randomUUID();
    const one = await pay(s, "100", { idempotencyKey: key, method: "MPESA", reference: "sjk3h7qw2p" });
    const two = await pay(s, "100", { idempotencyKey: key, method: "MPESA", reference: "SJK3H7QW2P" });
    expect([one.alreadyRecorded, two.alreadyRecorded, two.number]).toEqual([false, true, one.number]);
    const dup = await pay(s, "100", { method: "MPESA", reference: "SJK3H7QW2P" }).catch((e: unknown) => e);
    expect(dup).toBeInstanceOf(ValidationError);
    expect((dup as ValidationError).fieldErrors.reference?.[0]).toMatch(/already recorded on RCT-000001/);
    const bad = await pay(s, "100", { method: "MPESA", reference: "123" }).catch((e: unknown) => e);
    expect((bad as ValidationError).fieldErrors.reference?.[0]).toMatch(/10-character M-Pesa code/);
  });

  it("manual allocation can't exceed what an invoice owes or what was paid", async () => {
    const s = await setup();
    const inv = await invoice(s);
    await expect(
      pay(s, "500", { allocate: "manual", allocations: [{ invoiceId: inv.id, amount: "2000" }] }),
    ).rejects.toThrow(/Check the highlighted/);
    await expect(
      pay(s, "500", { allocate: "manual", allocations: [{ invoiceId: inv.id, amount: "600" }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    const r = await pay(s, "500", { allocate: "manual", allocations: [] });
    expect((await customerBalance(db, s.customer.id)).unappliedCredit).toBe("500.00");
    await applyCredit(
      db,
      s.sales,
      { paymentId: r.id },
      { allocations: [{ invoiceId: inv.id, amount: "500" }] },
    );
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid.toFixed(2)).toBe(
      "500.00",
    );
  });

  it("reversal reopens the invoices, posts a reversing entry, and needs more than the sales role", async () => {
    const s = await setup();
    const inv = await invoice(s);
    const r = await pay(s, "1900");
    await expect(reversePayment(db, s.sales, r.id, { version: 1, reason: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await reversePayment(db, s.accountant, r.id, { version: 1, reason: "Cheque bounced" });
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } })).amountPaid.toFixed(2)).toBe(
      "0.00",
    );
    expect((await customerBalance(db, s.customer.id)).balance).toBe("1900.00");
    expect(await accountBalance("CASH")).toBe("0.00");
    await expect(reversePayment(db, s.accountant, r.id, { version: 2, reason: "again" })).rejects.toThrow(
      /already reversed/,
    );
  });

  it("paying makes room under a cash-only customer's rule", async () => {
    const s = await setup();
    await db.customer.update({ where: { id: s.customer.id }, data: { creditLimit: "0" } });
    await invoice(s);
    const { id } = await createDraft(db, s.owner, "INVOICE", {
      customerId: s.customer.id,
      warehouseId: s.main.id,
      issueDate: today(),
      lines: [{ productId: s.product.id, unit: "CARTON", quantity: 1 }],
    });
    await expect(postInvoice(db, s.sales, id, { version: 1 })).rejects.toThrow(/cash-only/);
    await pay(s, "1900");
    expect((await postInvoice(db, s.sales, id, { version: 1 })).number).toMatch(/^INV-/);
  });
});

describe("credit notes", () => {
  it("credits returned goods at invoice prices, puts stock back, applies to the balance and journals it", async () => {
    const s = await setup();
    const inv = await invoice(s, 2); // 3,800; 200 pcs a carton, so stock 4000 → 3600
    const lines = await creditableLines(db, s.owner, inv.id);
    expect(lines.lines[0]).toMatchObject({ quantity: 2, remaining: 2 });
    await expect(
      createCreditNote(db, s.sales, inv.id, {
        idempotencyKey: randomUUID(),
        reason: "x",
        lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const key = randomUUID();
    const cn = await createCreditNote(db, s.accountant, inv.id, {
      idempotencyKey: key,
      reason: "Damaged carton returned",
      returnsToStock: "on",
      lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
    });
    expect(cn.number).toBe("CN-000001");
    expect(
      (
        await createCreditNote(db, s.accountant, inv.id, {
          idempotencyKey: key,
          reason: "x",
          lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
        })
      ).alreadyIssued,
    ).toBe(true);
    expect(await balance(db, s.product.id, s.main.id)).toBe(3800);
    const after = await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.amountCredited.toFixed(2)).toBe("1900.00");
    expect((await customerBalance(db, s.customer.id)).balance).toBe("1900.00");
    expect(await accountBalance("SALES_RETURNS")).toBe("-1637.93");
    expect((await trialBalance(db, s.owner)).balanced).toBe(true);
    // Only one carton left to credit.
    await expect(
      createCreditNote(db, s.accountant, inv.id, {
        idempotencyKey: randomUUID(),
        reason: "x",
        lines: [{ lineId: lines.lines[0]!.id, quantity: 2 }],
      }),
    ).rejects.toThrow(/Check the highlighted/);
    await expect(rawQuery(`UPDATE sales_documents SET total = 1 WHERE number = 'CN-000001'`)).rejects.toThrow(
      /cannot be changed/,
    );
  });

  it("crediting a paid invoice leaves credit on the account", async () => {
    const s = await setup();
    const inv = await invoice(s, 1);
    await pay(s, "1900");
    const lines = await creditableLines(db, s.owner, inv.id);
    await createCreditNote(db, s.owner, inv.id, {
      idempotencyKey: randomUUID(),
      reason: "Wrong flavour",
      lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
    });
    expect(await customerBalance(db, s.customer.id)).toMatchObject({
      unappliedCredit: "1900.00",
      balance: "-1900.00",
    });
  });
});

describe("statements, ageing, opening balances, manual journals and closing", () => {
  it("statement runs a balance; ageing buckets by due date", async () => {
    const s = await setup();
    await invoice(s, 1);
    await pay(s, "500");
    const st = await customerStatement(db, s.owner, s.customer.id);
    expect(st.lines.map((l) => [l.kind, l.balance])).toEqual([
      ["Invoice", "1900.00"],
      ["Payment", "1400.00"],
    ]);
    expect(st.closing).toBe("1400.00");
    // Due 30 days after the invoice (company terms); 45 days on, it's 15 days overdue.
    const aged = await agedReceivables(db, s.owner, addDays(today(), 45));
    expect(aged.rows[0]!.buckets).toEqual(["0.00", "1400.00", "0.00", "0.00", "0.00"]);
    expect((await agedReceivables(db, s.owner)).rows[0]!.buckets[0]).toBe("1400.00");
  });

  it("opening balances for old-system invoices, posted once", async () => {
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
    await db.salesDocument.update({
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
    await expect(startAccounting(db, s.sales)).rejects.toBeInstanceOf(ForbiddenError);
    const r = await startAccounting(db, s.owner);
    expect(r.openingNumber).toMatch(/^JE-/);
    expect((await startAccounting(db, s.owner)).openingNumber).toBeNull();
    expect(await accountBalance("AR")).toBe("700.00");
    expect(await accountBalance("OPENING")).toBe("700.00");
    const st = await customerStatement(db, s.owner, s.customer.id);
    expect(st.lines.map((l) => l.kind)).toEqual(["Invoice", "Paid in old system"]);
    expect(st.closing).toBe("700.00");
  });

  it("manual journals must balance and can't touch receivables; closed periods refuse postings", async () => {
    const s = await setup();
    const rent = await db.account.findFirstOrThrow({ where: { code: "6000" } });
    const bank = await db.account.findFirstOrThrow({ where: { systemKey: "BANK" } });
    const ar = await db.account.findFirstOrThrow({ where: { systemKey: "AR" } });
    const lines = (a: string, d: string, b: string, c: string) => [
      { accountId: a, debit: d, credit: "" },
      { accountId: b, debit: "", credit: c },
    ];
    await expect(
      postManualJournal(db, s.accountant, {
        date: today(),
        description: "Rent",
        lines: lines(rent.id, "100", bank.id, "90"),
      }),
    ).rejects.toThrow(/Check the highlighted/);
    await expect(
      postManualJournal(db, s.accountant, {
        date: today(),
        description: "x",
        lines: lines(ar.id, "100", bank.id, "100"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const e = await postManualJournal(db, s.accountant, {
      date: today(),
      description: "October rent",
      lines: lines(rent.id, "25000", bank.id, "25000"),
    });
    expect(e.number).toMatch(/^JE-/);
    await expect(
      closeBooks(db, s.accountant, { booksClosedUntil: addDays(today(), -1) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await closeBooks(db, s.owner, { booksClosedUntil: addDays(today(), -1) });
    await expect(pay(s, "100", { receivedOn: addDays(today(), -2) })).rejects.toBeInstanceOf(ConflictError);
    expect((await trialBalance(db, s.owner)).profit).toBe("-25000.00");
  });
});
