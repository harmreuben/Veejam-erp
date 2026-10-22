import "server-only";

import type { AccountType } from "@/generated/prisma/enums";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import type { DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError } from "@/server/errors";

/**
 * The chart of accounts VeeJam starts with. Accounts with a key are the ones
 * the system posts to by itself; the rest are for manual journals. Codes and
 * names can be changed later; keys can't.
 */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType; key?: SystemAccount }[] = [
  { code: "1000", name: "Cash on hand", type: "ASSET", key: "CASH" },
  { code: "1010", name: "M-Pesa paybill", type: "ASSET", key: "MPESA" },
  { code: "1020", name: "Bank", type: "ASSET", key: "BANK" },
  { code: "1100", name: "Accounts receivable (customers)", type: "ASSET", key: "AR" },
  { code: "1200", name: "Inventory", type: "ASSET", key: "INVENTORY" },
  { code: "2000", name: "Accounts payable (suppliers)", type: "LIABILITY", key: "AP" },
  { code: "2050", name: "Goods received, not yet billed", type: "LIABILITY", key: "GRNI" },
  { code: "2100", name: "VAT payable (output VAT)", type: "LIABILITY", key: "VAT_OUTPUT" },
  { code: "2110", name: "VAT recoverable (input VAT)", type: "ASSET", key: "VAT_INPUT" },
  { code: "3000", name: "Opening balances", type: "EQUITY", key: "OPENING" },
  { code: "3100", name: "Owner's capital", type: "EQUITY" },
  { code: "3200", name: "Owner's drawings", type: "EQUITY" },
  { code: "4000", name: "Sales", type: "INCOME", key: "SALES" },
  { code: "4100", name: "Sales returns and allowances", type: "INCOME", key: "SALES_RETURNS" },
  { code: "5000", name: "Cost of goods sold", type: "EXPENSE", key: "COGS" },
  { code: "5050", name: "Purchase price differences", type: "EXPENSE", key: "PRICE_DIFF" },
  { code: "5100", name: "Stock gains and losses", type: "EXPENSE", key: "STOCK_ADJ" },
  { code: "6000", name: "Rent", type: "EXPENSE" },
  { code: "6100", name: "Salaries and wages", type: "EXPENSE" },
  { code: "6200", name: "Transport and fuel", type: "EXPENSE" },
  { code: "6300", name: "Commissions", type: "EXPENSE" },
  { code: "6400", name: "Bank and M-Pesa charges", type: "EXPENSE" },
  { code: "6900", name: "Other expenses", type: "EXPENSE" },
];

export type SystemAccount =
  | "CASH"
  | "MPESA"
  | "BANK"
  | "AR"
  | "INVENTORY"
  | "AP"
  | "VAT_OUTPUT"
  | "VAT_INPUT"
  | "OPENING"
  | "SALES"
  | "SALES_RETURNS"
  | "COGS"
  | "GRNI"
  | "PRICE_DIFF"
  | "STOCK_ADJ";

/**
 * Accounts whose balance must always equal a sub-ledger (customer balances,
 * supplier balances, stock value, goods awaiting a bill). Only the system posts
 * to them; manual journals can't.
 */
export const SUBLEDGER_ACCOUNTS: readonly SystemAccount[] = ["AR", "AP", "INVENTORY", "GRNI"];

/** Where money paid or received by each method is kept. Cheques go through the bank. */
export const METHOD_ACCOUNT: Record<"CASH" | "MPESA" | "BANK_TRANSFER" | "CHEQUE", SystemAccount> = {
  CASH: "CASH",
  MPESA: "MPESA",
  BANK_TRANSFER: "BANK",
  CHEQUE: "BANK",
};

export type JournalLineInput = {
  account: SystemAccount | { id: string };
  debit?: string;
  credit?: string;
  customerId?: string | null;
  description?: string | null;
};

export type JournalInput = {
  date: string;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  sourceNumber?: string | null;
  actorId: string;
  lines: JournalLineInput[];
};

/** Refuse anything dated on or before the "books closed until" date. */
export async function assertBooksOpen(tx: DbOrTx, day: string): Promise<void> {
  const s = await tx.companySettings.findUnique({ where: { id: 1 }, select: { booksClosedUntil: true } });
  if (s?.booksClosedUntil && day <= fromDbDate(s.booksClosedUntil)) {
    throw new ConflictError(
      `The books are closed up to ${fromDbDate(s.booksClosedUntil)}. Use a later date, or ask an owner to reopen the period.`,
    );
  }
}

/**
 * Write one balanced journal entry inside the caller's transaction. Zero lines
 * are dropped. The database checks the balance again when the transaction commits.
 */
export async function postJournal(tx: DbOrTx, input: JournalInput): Promise<{ id: string; number: string }> {
  await assertBooksOpen(tx, input.date);
  const keys = [...new Set(input.lines.flatMap((l) => (typeof l.account === "string" ? [l.account] : [])))];
  const accounts = keys.length ? await tx.account.findMany({ where: { systemKey: { in: keys } } }) : [];
  const idFor = (a: JournalLineInput["account"]) => {
    if (typeof a !== "string") return a.id;
    const found = accounts.find((x) => x.systemKey === a);
    if (!found)
      throw new ConflictError(`The ${a} account is missing from the chart of accounts. Run: npm run db:seed`);
    return found.id;
  };

  const lines = input.lines
    .map((l) => ({
      accountId: idFor(l.account),
      debit: toDecimal(l.debit ?? "0"),
      credit: toDecimal(l.credit ?? "0"),
      customerId: l.customerId ?? null,
      description: l.description ?? null,
    }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  for (const l of lines) {
    if (l.debit.isNegative() || l.credit.isNegative() || (!l.debit.isZero() && !l.credit.isZero())) {
      throw new ConflictError("Each journal line is either a debit or a credit, never negative.");
    }
  }
  const debits = lines.reduce((s, l) => s.plus(l.debit), toDecimal(0));
  const credits = lines.reduce((s, l) => s.plus(l.credit), toDecimal(0));
  if (lines.length < 2 || !debits.equals(credits)) {
    throw new ConflictError(
      `The entry doesn't balance: debits ${formatKES(debits)}, credits ${formatKES(credits)}.`,
    );
  }

  const number = await nextNumber(tx, "JOURNAL_ENTRY");
  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: toDbDate(input.date),
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      sourceNumber: input.sourceNumber ?? null,
      createdById: input.actorId,
    },
  });
  await tx.journalLine.createMany({
    data: lines.map((l) => ({
      entryId: entry.id,
      accountId: l.accountId,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
      customerId: l.customerId,
      description: l.description,
    })),
  });
  return { id: entry.id, number };
}

/** Dr receivables, Cr sales (excl. VAT) and VAT payable; and Dr cost of sales, Cr inventory for the stock. */
export function invoiceJournal(inv: {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  day: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  actorId: string;
  /** Cost of the stock sold (positive). */
  cost?: string;
}): JournalInput {
  return {
    date: inv.day,
    description: `Invoice ${inv.number} — ${inv.customerName}`,
    sourceType: "Invoice",
    sourceId: inv.id,
    sourceNumber: inv.number,
    actorId: inv.actorId,
    lines: [
      { account: "AR", debit: inv.total, customerId: inv.customerId },
      { account: "SALES", credit: inv.subtotal },
      { account: "VAT_OUTPUT", credit: inv.taxTotal },
      { account: "COGS", debit: inv.cost ?? "0" },
      { account: "INVENTORY", credit: inv.cost ?? "0" },
    ],
  };
}

/**
 * Post a change in stock value against another account: a gain debits
 * inventory, a loss credits it. Nothing is posted when the change is zero
 * (e.g. stock with no cost yet).
 */
export async function postStockValue(
  tx: DbOrTx,
  input: {
    change: { isZero(): boolean; isNegative(): boolean; abs(): { toFixed(n: number): string } };
    against: SystemAccount;
    date: string;
    description: string;
    sourceType: string;
    sourceId: string;
    sourceNumber: string;
    actorId: string;
  },
): Promise<{ id: string; number: string } | null> {
  if (input.change.isZero()) return null;
  const amount = input.change.abs().toFixed(2);
  const gain = !input.change.isNegative();
  return postJournal(tx, {
    date: input.date,
    description: input.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    actorId: input.actorId,
    lines: gain
      ? [
          { account: "INVENTORY", debit: amount },
          { account: input.against, credit: amount },
        ]
      : [
          { account: input.against, debit: amount },
          { account: "INVENTORY", credit: amount },
        ],
  });
}

/**
 * Post the mirror image of a document's journal entry (debits and credits
 * swapped), e.g. when a bill is cancelled. The original stays untouched.
 */
export async function reverseJournalOf(
  tx: DbOrTx,
  source: { type: string; id: string },
  input: { date: string; description: string; sourceType: string; sourceNumber: string; actorId: string },
): Promise<{ id: string; number: string } | null> {
  const entries = await tx.journalEntry.findMany({
    where: { sourceType: source.type, sourceId: source.id },
    include: { lines: true },
  });
  const lines = entries.flatMap((e) =>
    e.lines.map((l) => ({
      account: { id: l.accountId },
      debit: l.credit.toFixed(2),
      credit: l.debit.toFixed(2),
      customerId: l.customerId,
      description: l.description,
    })),
  );
  if (!lines.length) return null;
  return postJournal(tx, {
    date: input.date,
    description: input.description,
    sourceType: input.sourceType,
    sourceId: source.id,
    sourceNumber: input.sourceNumber,
    actorId: input.actorId,
    lines,
  });
}
