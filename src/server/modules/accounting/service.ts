import "server-only";

import type { AccountType } from "@/generated/prisma/enums";
import { fromDbDate, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { accountSchema, closeBooksSchema, journalSchema } from "@/server/modules/payments/schemas";
import type { AuditContext } from "@/server/modules/pricing/service";
import { isUuid, parseInput } from "@/server/shared/validation";

import { invoiceJournal, postJournal, postStockValue, SUBLEDGER_ACCOUNTS } from "./journal";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Asset",
  LIABILITY: "Liability",
  EQUITY: "Equity",
  INCOME: "Income",
  EXPENSE: "Expense",
};

/** Debit-balance accounts show debits minus credits; the others the reverse. */
const debitNormal = (t: AccountType) => t === "ASSET" || t === "EXPENSE";

const auditBase = (actor: Actor, ctx: AuditContext) => ({
  actorUserId: actor.id,
  actorLabel: actor.email,
  ...ctx,
});

// ─── Getting started ────────────────────────────────────────────────

/**
 * Stock value that isn't in the Inventory account yet: Σ product stock values
 * minus the Inventory balance. Every costed movement is journalled as it
 * happens, so this only differs by stock that was on hand before costing
 * started (or was valued afterwards without a journal, which shouldn't happen).
 */
async function inventoryNotInBooks(db: Db | Parameters<Parameters<Db["$transaction"]>[0]>[0]) {
  const rows = await db.$queryRaw<{ stock: string; books: string }[]>`
    SELECT (SELECT COALESCE(SUM(value), 0) FROM inventory_valuations)::text AS stock,
           (SELECT COALESCE(SUM(l.debit - l.credit), 0)
              FROM journal_lines l JOIN accounts a ON a.id = l.account_id
             WHERE a.system_key = 'INVENTORY')::text AS books`;
  return toDecimal(rows[0]!.stock).minus(rows[0]!.books);
}

export async function accountingStatus(db: Db) {
  const [opening, unjournaled, settings, accounts, owedOld] = await Promise.all([
    db.journalEntry.findFirst({
      where: { sourceType: "OpeningBalances" },
      select: { id: true, number: true, date: true },
    }),
    db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM sales_documents d
       WHERE d.kind = 'INVOICE' AND d.status = 'POSTED' AND NOT d.historical
         AND NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.source_type = 'Invoice' AND j.source_id = d.id)`,
    db.companySettings.findUnique({ where: { id: 1 }, select: { booksClosedUntil: true } }),
    db.account.count(),
    db.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM sales_documents d
         WHERE d.historical AND d.kind = 'INVOICE' AND d.status = 'POSTED'
           AND d.total - (d.amount_paid - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                                                     WHERE a.invoice_id = d.id AND a.payment_id IS NOT NULL
                                                       AND a.reversed_at IS NULL), 0)) > 0) AS exists`,
  ]);
  return {
    openingPosted: opening ? { number: opening.number, date: fromDbDate(opening.date) } : null,
    /** Old-system invoices with money owed whose opening entry hasn't been posted yet. */
    openingNeeded: !opening && Boolean(owedOld[0]?.exists),
    invoicesWithoutJournal: Number(unjournaled[0]?.n ?? 0),
    booksClosedUntil: settings?.booksClosedUntil ? fromDbDate(settings.booksClosedUntil) : null,
    hasAccounts: accounts > 0,
    /** Stock value not yet in the Inventory account (e.g. opening stock costed after it arrived). */
    inventoryNotInBooks: (await inventoryNotInBooks(db)).toFixed(2),
  };
}

/**
 * Start the books, once:
 *  - what customers still owed on old-system invoices when they were brought
 *    across becomes one opening entry: Dr receivables (per customer), Cr opening balances;
 *  - invoices posted in the new system before accounting existed get their journal entries.
 * Safe to run again: anything already posted is skipped.
 */
export async function startAccounting(db: Db, actor: Actor, ctx: AuditContext = {}) {
  authorize(actor, "accounting.close");
  return db.$transaction(
    async (tx) => {
      let openingNumber: string | null = null;
      const opening = await tx.journalEntry.findFirst({ where: { sourceType: "OpeningBalances" } });
      if (!opening) {
        const historical = await tx.salesDocument.findMany({
          where: { kind: "INVOICE", status: "POSTED", historical: true },
          include: { allocationsReceived: { where: { reversedAt: null, paymentId: { not: null } } } },
        });
        // Owed at cut-over = total − what was paid in the old system (new payments are posted separately).
        const byCustomer = new Map<string, ReturnType<typeof toDecimal>>();
        let latest = "";
        for (const inv of historical) {
          const newPaid = inv.allocationsReceived.reduce((s, a) => s.plus(a.amount), toDecimal(0));
          const oldPaid = inv.amountPaid.minus(newPaid);
          const owed = inv.total.minus(oldPaid);
          if (owed.greaterThan(0))
            byCustomer.set(inv.customerId, (byCustomer.get(inv.customerId) ?? toDecimal(0)).plus(owed));
          const d = fromDbDate(inv.issueDate);
          if (d > latest) latest = d;
        }
        const total = [...byCustomer.values()].reduce((s, x) => s.plus(x), toDecimal(0));
        if (total.greaterThan(0)) {
          const entry = await postJournal(tx, {
            date: latest || todayInNairobi(),
            description: "Opening balances: amounts owed on invoices from the old system",
            sourceType: "OpeningBalances",
            actorId: actor.id,
            lines: [
              ...[...byCustomer.entries()].map(([customerId, amount]) => ({
                account: "AR" as const,
                debit: amount.toFixed(2),
                customerId,
              })),
              { account: "OPENING", credit: total.toFixed(2) },
            ],
          });
          openingNumber = entry.number;
        }
      }

      const missing = await tx.salesDocument.findMany({
        where: {
          kind: "INVOICE",
          status: "POSTED",
          historical: false,
        },
        include: { customer: { select: { name: true } } },
        orderBy: { postedAt: "asc" },
      });
      const done = new Set(
        (
          await tx.journalEntry.findMany({
            where: { sourceType: "Invoice", sourceId: { in: missing.map((m) => m.id) } },
            select: { sourceId: true },
          })
        ).map((j) => j.sourceId),
      );
      let backfilled = 0;
      for (const inv of missing.filter((m) => !done.has(m.id))) {
        await postJournal(
          tx,
          invoiceJournal({
            id: inv.id,
            number: inv.number!,
            customerId: inv.customerId,
            customerName: inv.customer.name,
            day: fromDbDate(inv.issueDate),
            subtotal: inv.subtotal.toFixed(2),
            taxTotal: inv.taxTotal.toFixed(2),
            total: inv.total.toFixed(2),
            actorId: actor.id,
          }),
        );
        backfilled++;
      }
      // Stock on hand that hasn't reached the Inventory account yet (opening stock).
      const stockGap = await inventoryNotInBooks(tx);
      const stockEntry = await postStockValue(tx, {
        change: stockGap,
        against: "OPENING",
        date: todayInNairobi(),
        description: "Opening balances: value of stock on hand",
        sourceType: "OpeningInventory",
        sourceId: "00000000-0000-4000-8000-000000000002",
        sourceNumber: "Opening stock",
        actorId: actor.id,
      });
      if (openingNumber || backfilled || stockEntry) {
        await writeAudit(tx, {
          ...auditBase(actor, ctx),
          action: "OPENING_BALANCES_POSTED",
          entityType: "System",
          summary: `Accounting started${openingNumber ? `: opening balances ${openingNumber}` : ""}${backfilled ? `, ${backfilled} earlier invoice(s) journalled` : ""}${stockEntry ? `, opening stock value ${formatKES(stockGap.toFixed(2))} (${stockEntry.number})` : ""}`,
        });
      }
      return { openingNumber, backfilled, stockValue: stockEntry ? stockGap.toFixed(2) : null };
    },
    { maxWait: 30_000, timeout: 120_000 },
  );
}

// ─── Reading ────────────────────────────────────────────────────────

/** Every account with its debit/credit totals and balance up to a date. */
export async function trialBalance(db: Db, actor: Actor, asOf: string = todayInNairobi()) {
  authorize(actor, "accounting.view");
  const [accounts, sums] = await Promise.all([
    db.account.findMany({ orderBy: { code: "asc" } }),
    db.$queryRaw<{ account_id: string; debit: string; credit: string }[]>`
      SELECT l.account_id, SUM(l.debit)::text AS debit, SUM(l.credit)::text AS credit
        FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.date <= ${toDbDate(asOf)}::date
       GROUP BY l.account_id`,
  ]);
  const rows = accounts.map((a) => {
    const s = sums.find((x) => x.account_id === a.id);
    const debit = toDecimal(s?.debit ?? "0");
    const credit = toDecimal(s?.credit ?? "0");
    const net = debit.minus(credit);
    return {
      ...a,
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      /** Shown in the account's normal direction (assets/expenses: debit; others: credit). */
      balance: (debitNormal(a.type) ? net : net.negated()).toFixed(2),
      /** Trial balance columns. */
      tbDebit: net.greaterThan(0) ? net.toFixed(2) : "0.00",
      tbCredit: net.lessThan(0) ? net.negated().toFixed(2) : "0.00",
    };
  });
  const totalDebit = rows.reduce((s, r) => s.plus(r.tbDebit), toDecimal(0));
  const totalCredit = rows.reduce((s, r) => s.plus(r.tbCredit), toDecimal(0));
  const income = rows.filter((r) => r.type === "INCOME").reduce((s, r) => s.plus(r.balance), toDecimal(0));
  const expenses = rows.filter((r) => r.type === "EXPENSE").reduce((s, r) => s.plus(r.balance), toDecimal(0));
  return {
    asOf,
    rows,
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    balanced: totalDebit.equals(totalCredit),
    profit: income.minus(expenses).toFixed(2),
  };
}

export async function accountLedger(
  db: Db,
  actor: Actor,
  accountId: string,
  range: { from?: string; to?: string } = {},
) {
  authorize(actor, "accounting.view");
  if (!isUuid(accountId)) throw new NotFoundError();
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) throw new NotFoundError();
  const from = range.from ?? null;
  const to = range.to ?? todayInNairobi();
  const openingRow = from
    ? await db.$queryRaw<{ net: string | null }[]>`
        SELECT (SUM(l.debit) - SUM(l.credit))::text AS net
          FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
         WHERE l.account_id = ${accountId}::uuid AND e.date < ${toDbDate(from)}::date`
    : [{ net: "0" }];
  const sign = debitNormal(account.type) ? 1 : -1;
  let running = toDecimal(openingRow[0]?.net ?? "0").times(sign);
  const opening = running.toFixed(2);
  const lines = await db.journalLine.findMany({
    where: {
      accountId,
      entry: { date: { ...(from ? { gte: toDbDate(from) } : {}), lte: toDbDate(to) } },
    },
    include: {
      entry: {
        select: {
          id: true,
          number: true,
          date: true,
          description: true,
          sourceType: true,
          sourceId: true,
          sourceNumber: true,
        },
      },
      customer: { select: { id: true, name: true } },
    },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
    take: 2000,
  });
  return {
    account,
    from,
    to,
    opening,
    lines: lines.map((l) => {
      running = running.plus(l.debit.minus(l.credit).times(sign));
      return {
        id: String(l.id),
        date: fromDbDate(l.entry.date),
        entry: l.entry,
        customer: l.customer,
        description: l.description ?? l.entry.description,
        debit: l.debit.toFixed(2),
        credit: l.credit.toFixed(2),
        balance: running.toFixed(2),
      };
    }),
    closing: running.toFixed(2),
  };
}

export async function listJournal(db: Db, actor: Actor, filter: { q?: string; source?: string } = {}) {
  authorize(actor, "accounting.view");
  const q = filter.q?.trim();
  const rows = await db.journalEntry.findMany({
    where: {
      ...(filter.source && filter.source !== "ALL" ? { sourceType: filter.source } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { sourceNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { lines: { select: { debit: true } }, createdBy: { select: { fullName: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return rows.map((e) => ({
    ...e,
    amount: e.lines.reduce((s, l) => s.plus(l.debit), toDecimal(0)).toFixed(2),
  }));
}

export async function getJournalEntry(db: Db, actor: Actor, id: string) {
  authorize(actor, "accounting.view");
  if (!isUuid(id)) throw new NotFoundError();
  const e = await db.journalEntry.findUnique({
    where: { id },
    include: {
      createdBy: { select: { fullName: true } },
      lines: {
        orderBy: { id: "asc" },
        include: { account: true, customer: { select: { id: true, name: true } } },
      },
    },
  });
  if (!e) throw new NotFoundError();
  return {
    ...e,
    day: fromDbDate(e.date),
    lines: e.lines.map((l) => ({
      ...l,
      id: String(l.id),
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
    })),
  };
}

export async function listAccounts(db: Db, actor: Actor) {
  authorize(actor, "accounting.view");
  return db.account.findMany({ orderBy: { code: "asc" } });
}

// ─── Writing ────────────────────────────────────────────────────────

/** A journal entry typed by the accountant, e.g. rent paid from the bank. */
export async function postManualJournal(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "accounting.journal");
  const v = parseInput(journalSchema, input);
  const lines = v.lines.filter((l) => l.accountId || l.debit || l.credit);
  const errors: Record<string, string[]> = {};
  lines.forEach((l) => {
    const i = v.lines.indexOf(l);
    if (!l.accountId) (errors[`lines.${i}.accountId`] ??= []).push("Choose an account");
    const d = toDecimal(l.debit ?? "0");
    const c = toDecimal(l.credit ?? "0");
    if (d.isZero() === c.isZero()) (errors[`lines.${i}.debit`] ??= []).push("Enter a debit or a credit");
  });
  if (lines.length < 2) errors.lines = ["An entry needs at least two lines"];
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const debits = lines.reduce((s, l) => s.plus(l.debit ?? "0"), toDecimal(0));
  const credits = lines.reduce((s, l) => s.plus(l.credit ?? "0"), toDecimal(0));
  if (!debits.equals(credits)) {
    throw new ValidationError({
      lines: [`Debits (${formatKES(debits)}) and credits (${formatKES(credits)}) must be equal`],
    });
  }
  const ids = [...new Set(lines.map((l) => l.accountId!))];
  const accounts = await db.account.findMany({ where: { id: { in: ids } } });
  if (accounts.length !== ids.length || accounts.some((a) => a.status !== "ACTIVE")) {
    throw new ValidationError({ lines: ["Choose active accounts"] });
  }
  if (accounts.some((a) => a.systemKey && (SUBLEDGER_ACCOUNTS as readonly string[]).includes(a.systemKey))) {
    throw new ValidationError({
      lines: [
        "Customer and supplier balances, stock value and goods awaiting a bill change only through their own documents (invoices, payments, bills, goods received, stock adjustments), not manual journals",
      ],
    });
  }
  return db.$transaction(async (tx) => {
    const entry = await postJournal(tx, {
      date: v.date,
      description: v.description,
      sourceType: "Manual",
      actorId: actor.id,
      lines: lines.map((l) => ({
        account: { id: l.accountId! },
        debit: l.debit ?? "0",
        credit: l.credit ?? "0",
        description: l.description,
      })),
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "JOURNAL_POSTED",
      entityType: "JournalEntry",
      entityId: entry.id,
      summary: `${entry.number} ${v.description}: ${formatKES(debits)}`,
    });
    return entry;
  });
}

export async function closeBooks(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "accounting.close");
  const v = parseInput(closeBooksSchema, input);
  if (v.booksClosedUntil && v.booksClosedUntil >= todayInNairobi()) {
    throw new ValidationError({ booksClosedUntil: ["Close up to a day before today"] });
  }
  await db.$transaction(async (tx) => {
    const before = await tx.companySettings.findUniqueOrThrow({
      where: { id: 1 },
      select: { booksClosedUntil: true },
    });
    await tx.companySettings.update({
      where: { id: 1 },
      data: { booksClosedUntil: v.booksClosedUntil ? toDbDate(v.booksClosedUntil) : null },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "BOOKS_CLOSED",
      entityType: "CompanySettings",
      entityId: "1",
      summary: v.booksClosedUntil ? `Books closed up to ${v.booksClosedUntil}` : "Books reopened",
      before: { booksClosedUntil: before.booksClosedUntil ? fromDbDate(before.booksClosedUntil) : null },
      after: { booksClosedUntil: v.booksClosedUntil },
    });
  });
}

export async function createAccount(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "accounting.close");
  const v = parseInput(accountSchema, input);
  if (await db.account.findUnique({ where: { code: v.code } })) {
    throw new ValidationError({ code: ["Another account already uses this code"] });
  }
  return db.$transaction(async (tx) => {
    const a = await tx.account.create({ data: v });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "ACCOUNT_CREATED",
      entityType: "Account",
      entityId: a.id,
      summary: `${a.code} ${a.name} (${ACCOUNT_TYPE_LABELS[a.type]})`,
    });
    return a;
  });
}

export async function renameAccount(db: Db, actor: Actor, id: string, name: string, ctx: AuditContext = {}) {
  authorize(actor, "accounting.close");
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new ValidationError({ name: ["Name the account"] });
  await db.$transaction(async (tx) => {
    const a = await tx.account.findUnique({ where: { id } });
    if (!a) throw new NotFoundError();
    if (a.name === clean) return;
    await tx.account.update({ where: { id }, data: { name: clean } });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "ACCOUNT_UPDATED",
      entityType: "Account",
      entityId: id,
      summary: `${a.code}: "${a.name}" → "${clean}"`,
    });
  });
}

export { ConflictError };
