import "server-only";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { fromDbDate, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertBooksOpen, postJournal, type SystemAccount } from "@/server/modules/accounting/journal";
import { isUniqueViolation } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { isUuid, parseInput } from "@/server/shared/validation";

import { applyCreditSchema, METHOD_LABELS, paymentSchema, reverseSchema } from "./schemas";

const MONEY_ACCOUNT: Record<PaymentMethod, SystemAccount> = {
  CASH: "CASH",
  MPESA: "MPESA",
  BANK_TRANSFER: "BANK",
  CHEQUE: "BANK",
};

const auditBase = (actor: Actor, ctx: AuditContext) => ({
  actorUserId: actor.id,
  actorLabel: actor.email,
  ...ctx,
});

// ─── Balances ───────────────────────────────────────────────────────

export type CustomerBalance = {
  /** Unpaid on posted invoices. */
  owedOnInvoices: string;
  /** Payments and credit notes not yet applied to an invoice. */
  unappliedCredit: string;
  /** What the customer owes overall (negative = we owe them). */
  balance: string;
};

export async function customerBalance(db: DbOrTx, customerId: string): Promise<CustomerBalance> {
  const rows = await db.$queryRaw<{ owed: string; payments: string; credits: string }[]>`
    SELECT
      (SELECT COALESCE(SUM(total - amount_paid - amount_credited), 0) FROM sales_documents
        WHERE customer_id = ${customerId}::uuid AND kind = 'INVOICE' AND status = 'POSTED')::text AS owed,
      (SELECT COALESCE(SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                                                 WHERE a.payment_id = p.id AND a.reversed_at IS NULL), 0)), 0)
         FROM payments p WHERE p.customer_id = ${customerId}::uuid AND p.status = 'POSTED')::text AS payments,
      (SELECT COALESCE(SUM(c.total - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a
                                                 WHERE a.credit_note_id = c.id AND a.reversed_at IS NULL), 0)), 0)
         FROM sales_documents c WHERE c.customer_id = ${customerId}::uuid AND c.kind = 'CREDIT_NOTE'
          AND c.status = 'POSTED')::text AS credits`;
  const r = rows[0]!;
  const owed = toDecimal(r.owed);
  const credit = toDecimal(r.payments).plus(r.credits);
  return {
    owedOnInvoices: owed.toFixed(2),
    unappliedCredit: credit.toFixed(2),
    balance: owed.minus(credit).toFixed(2),
  };
}

/** Posted invoices with something left to pay, oldest first. */
export async function openInvoices(db: DbOrTx, customerId: string) {
  const rows = await db.salesDocument.findMany({
    where: { customerId, kind: "INVOICE", status: "POSTED" },
    orderBy: [{ issueDate: "asc" }, { postedAt: "asc" }],
    select: {
      id: true,
      number: true,
      issueDate: true,
      dueDate: true,
      total: true,
      amountPaid: true,
      amountCredited: true,
      historical: true,
    },
  });
  return rows
    .map((r) => ({
      id: r.id,
      number: r.number!,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      historical: r.historical,
      total: r.total.toFixed(2),
      outstanding: r.total.minus(r.amountPaid).minus(r.amountCredited).toFixed(2),
    }))
    .filter((r) => toDecimal(r.outstanding).greaterThan(0));
}

/**
 * Apply amounts to invoices inside a transaction. Locks each invoice, checks it
 * belongs to the customer and that no invoice gets more than it still owes.
 */
async function allocate(
  tx: DbOrTx,
  actor: Actor,
  customerId: string,
  source: { paymentId: string } | { creditNoteId: string },
  available: string,
  wanted: { invoiceId: string; amount: string }[],
): Promise<{ applied: string; lines: { invoiceId: string; number: string; amount: string }[] }> {
  const ids = [...new Set(wanted.map((w) => w.invoiceId))];
  if (ids.length !== wanted.length) throw new ValidationError({ allocations: ["Each invoice only once"] });
  for (const id of [...ids].sort()) {
    await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${id}::uuid FOR UPDATE`;
  }
  const invoices = await tx.salesDocument.findMany({ where: { id: { in: ids } } });
  let total = toDecimal(0);
  const lines: { invoiceId: string; number: string; amount: string }[] = [];
  for (const w of wanted) {
    const inv = invoices.find((i) => i.id === w.invoiceId);
    if (!inv || inv.kind !== "INVOICE" || inv.status !== "POSTED" || inv.customerId !== customerId) {
      throw new ValidationError({ allocations: ["Only this customer's posted invoices can be paid"] });
    }
    const outstanding = inv.total.minus(inv.amountPaid).minus(inv.amountCredited);
    const amount = toDecimal(w.amount);
    if (amount.greaterThan(outstanding)) {
      throw new ValidationError({
        allocations: [`${inv.number} only has ${formatKES(outstanding)} left to pay`],
      });
    }
    total = total.plus(amount);
    lines.push({ invoiceId: inv.id, number: inv.number!, amount: amount.toFixed(2) });
  }
  if (total.greaterThan(available)) {
    throw new ValidationError({
      allocations: [`That applies ${formatKES(total)}, but only ${formatKES(available)} is available`],
    });
  }
  for (const l of lines) {
    await tx.paymentAllocation.create({
      data: { invoiceId: l.invoiceId, amount: l.amount, createdById: actor.id, ...source },
    });
    await tx.salesDocument.update({
      where: { id: l.invoiceId },
      data:
        "paymentId" in source
          ? { amountPaid: { increment: l.amount } }
          : { amountCredited: { increment: l.amount } },
    });
  }
  return { applied: total.toFixed(2), lines };
}

/** Oldest invoices first, until the money runs out. */
async function autoAllocation(tx: DbOrTx, customerId: string, available: string) {
  let left = toDecimal(available);
  const out: { invoiceId: string; amount: string }[] = [];
  for (const inv of await openInvoices(tx, customerId)) {
    if (left.lessThanOrEqualTo(0)) break;
    const take = left.lessThan(inv.outstanding) ? left : toDecimal(inv.outstanding);
    out.push({ invoiceId: inv.id, amount: take.toFixed(2) });
    left = left.minus(take);
  }
  return out;
}

// ─── Recording payments ─────────────────────────────────────────────

export type RecordResult = { id: string; number: string; alreadyRecorded: boolean };

/**
 * Record money received. In one transaction: number the receipt (RCT-),
 * apply it to invoices (oldest first unless chosen), post Dr cash/M-Pesa/bank,
 * Cr receivables, and audit. The same form submitted twice records once; the
 * same M-Pesa code or cheque can't be recorded twice.
 */
export async function recordPayment(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<RecordResult> {
  authorize(actor, "payments.record");
  const v = parseInput(paymentSchema, input);
  if (v.receivedOn > todayInNairobi()) throw new ValidationError({ receivedOn: ["Can't be in the future"] });

  const existing = await db.payment.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
  if (existing) return { id: existing.id, number: existing.number, alreadyRecorded: true };

  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${v.customerId}::uuid FOR UPDATE`;
      const customer = await tx.customer.findUnique({ where: { id: v.customerId } });
      if (!customer) throw new ValidationError({ customerId: ["Choose a customer"] });
      if (v.reference) {
        const dup = await tx.payment.findUnique({
          where: { method_reference: { method: v.method, reference: v.reference } },
        });
        if (dup) {
          throw new ValidationError({
            reference: [
              `${METHOD_LABELS[v.method]} reference ${v.reference} was already recorded on ${dup.number} (${formatKES(dup.amount.toFixed(2))}).`,
            ],
          });
        }
      }
      await assertBooksOpen(tx, v.receivedOn);

      const number = await nextNumber(tx, "RECEIPT");
      const payment = await tx.payment.create({
        data: {
          number,
          customerId: customer.id,
          receivedOn: toDbDate(v.receivedOn),
          method: v.method,
          reference: v.reference,
          amount: v.amount,
          notes: v.notes,
          idempotencyKey: v.idempotencyKey,
          receivedById: actor.id,
        },
      });
      const wanted = v.allocate === "auto" ? await autoAllocation(tx, customer.id, v.amount) : v.allocations;
      const applied = await allocate(tx, actor, customer.id, { paymentId: payment.id }, v.amount, wanted);

      await postJournal(tx, {
        date: v.receivedOn,
        description: `Payment ${number} from ${customer.name} (${METHOD_LABELS[v.method]}${v.reference ? ` ${v.reference}` : ""})`,
        sourceType: "Payment",
        sourceId: payment.id,
        sourceNumber: number,
        actorId: actor.id,
        lines: [
          { account: MONEY_ACCOUNT[v.method], debit: v.amount },
          { account: "AR", credit: v.amount, customerId: customer.id },
        ],
      });
      const unapplied = toDecimal(v.amount).minus(applied.applied);
      await writeAudit(tx, {
        ...auditBase(actor, ctx),
        action: "PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        summary:
          `${number}: ${formatKES(v.amount)} from ${customer.name} by ${METHOD_LABELS[v.method]}` +
          (applied.lines.length ? `, applied to ${applied.lines.map((l) => l.number).join(", ")}` : "") +
          (unapplied.greaterThan(0) ? `; ${formatKES(unapplied)} kept as credit` : ""),
        after: { amount: v.amount, method: v.method, reference: v.reference, allocations: applied.lines },
      });
      return { id: payment.id, number, alreadyRecorded: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.payment.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number, alreadyRecorded: true };
      if (v.reference) {
        throw new ValidationError({ reference: [`${v.reference} has just been recorded by someone else.`] });
      }
    }
    throw error;
  }
}

/** Apply credit still on a payment or credit note to the customer's invoices. */
export async function applyCredit(
  db: Db,
  actor: Actor,
  source: { paymentId: string } | { creditNoteId: string },
  input: unknown,
  ctx: AuditContext = {},
): Promise<string> {
  authorize(actor, "payments.record");
  const v = parseInput(applyCreditSchema, input);
  const wanted = v.allocations.filter((a) => a.amount !== null && Number(a.amount) > 0) as {
    invoiceId: string;
    amount: string;
  }[];
  if (!wanted.length)
    throw new ValidationError({ allocations: ["Enter an amount for at least one invoice"] });
  return db.$transaction(async (tx) => {
    let customerId: string;
    let available: ReturnType<typeof toDecimal>;
    let label: string;
    if ("paymentId" in source) {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${source.paymentId}::uuid FOR UPDATE`;
      const p = await tx.payment.findUnique({
        where: { id: source.paymentId },
        include: { allocations: true },
      });
      if (!p) throw new NotFoundError();
      if (p.status !== "POSTED") throw new ConflictError(`${p.number} was reversed.`);
      customerId = p.customerId;
      label = p.number;
      available = p.amount.minus(
        p.allocations.filter((a) => !a.reversedAt).reduce((s, a) => s.plus(a.amount), toDecimal(0)),
      );
    } else {
      await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${source.creditNoteId}::uuid FOR UPDATE`;
      const c = await tx.salesDocument.findUnique({
        where: { id: source.creditNoteId },
        include: { allocationsGiven: true },
      });
      if (!c || c.kind !== "CREDIT_NOTE" || c.status !== "POSTED") throw new NotFoundError();
      customerId = c.customerId;
      label = c.number!;
      available = c.total.minus(
        c.allocationsGiven.filter((a) => !a.reversedAt).reduce((s, a) => s.plus(a.amount), toDecimal(0)),
      );
    }
    const applied = await allocate(tx, actor, customerId, source, available.toFixed(2), wanted);
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "CREDIT_APPLIED",
      entityType: "paymentId" in source ? "Payment" : "SalesDocument",
      entityId: "paymentId" in source ? source.paymentId : source.creditNoteId,
      summary: `${label}: ${formatKES(applied.applied)} applied to ${applied.lines.map((l) => l.number).join(", ")}`,
      after: { allocations: applied.lines },
    });
    return applied.applied;
  });
}

/**
 * Reverse a payment recorded by mistake (wrong customer, bounced cheque,
 * duplicate). Its allocations stop counting, the invoices are open again,
 * and a reversing journal entry is posted today. Nothing is deleted.
 */
export async function reversePayment(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "payments.reverse");
  const v = parseInput(reverseSchema, input);
  await db.$transaction((tx) => undoPayment(tx, actor, id, v, ctx, false));
}

/**
 * Delete a payment (owners and admins): reversed in full like "Reverse", then
 * hidden from lists and balances. The row stays, frozen, for the record. A
 * payment that was already reversed is simply hidden.
 */
export async function deletePayment(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "payments.delete");
  const v = parseInput(reverseSchema, input);
  await db.$transaction((tx) => undoPayment(tx, actor, id, v, ctx, true));
}

async function undoPayment(
  tx: DbOrTx,
  actor: Actor,
  id: string,
  v: { version: number; reason: string },
  ctx: AuditContext,
  andDelete: boolean,
) {
  await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
  const p = await tx.payment.findUnique({ where: { id }, include: { allocations: true, customer: true } });
  if (!p) throw new NotFoundError();
  if (p.deletedAt) throw new ConflictError(`${p.number} was already deleted.`);
  if (p.version !== v.version)
    throw new ConflictError(`${p.number} was changed by someone else. Reload the page.`);
  if (p.status !== "POSTED" && !andDelete) throw new ConflictError(`${p.number} is already reversed.`);
  const amount = p.amount.toFixed(2);

  if (p.status === "POSTED") {
    const today = todayInNairobi();
    for (const a of p.allocations.filter((x) => !x.reversedAt)) {
      await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${a.invoiceId}::uuid FOR UPDATE`;
      await tx.paymentAllocation.update({ where: { id: a.id }, data: { reversedAt: new Date() } });
      await tx.salesDocument.update({
        where: { id: a.invoiceId },
        data: { amountPaid: { decrement: a.amount } },
      });
    }
    await tx.payment.update({
      where: { id },
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedById: actor.id,
        reverseReason: v.reason,
        version: { increment: 1 },
      },
    });
    await postJournal(tx, {
      date: today,
      description: `${andDelete ? "Deletion" : "Reversal"} of payment ${p.number} (${p.customer.name}): ${v.reason}`,
      sourceType: "PaymentReversal",
      sourceId: p.id,
      sourceNumber: p.number,
      actorId: actor.id,
      lines: [
        { account: "AR", debit: amount, customerId: p.customerId },
        { account: MONEY_ACCOUNT[p.method], credit: amount },
      ],
    });
  }
  if (andDelete) {
    await tx.payment.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedById: actor.id,
        // Frees the M-Pesa code or cheque number to be entered again correctly.
        reference: p.reference ? `${p.reference} (deleted ${p.number})` : null,
        version: { increment: 1 },
      },
    });
  }
  await writeAudit(tx, {
    ...auditBase(actor, ctx),
    action: andDelete ? "PAYMENT_DELETED" : "PAYMENT_REVERSED",
    entityType: "Payment",
    entityId: id,
    summary: `${p.number} (${formatKES(amount)}, ${p.customer.name}) ${andDelete ? "deleted" : "reversed"}: ${v.reason}`,
    before: {
      status: p.status,
      amount,
      method: p.method,
      reference: p.reference,
      receivedOn: p.receivedOn.toISOString().slice(0, 10),
      allocations: p.allocations
        .filter((x) => !x.reversedAt)
        .map((x) => ({ invoiceId: x.invoiceId, amount: x.amount.toFixed(2) })),
    },
  });
}

// ─── Reading ────────────────────────────────────────────────────────

export async function listPayments(
  db: Db,
  actor: Actor,
  filter: { q?: string; method?: string; customerId?: string; deleted?: boolean } = {},
) {
  authorize(actor, "sales.view");
  const q = filter.q?.trim();
  const rows = await db.payment.findMany({
    where: {
      // Deleted payments only when asked for.
      deletedAt: filter.deleted ? { not: null } : null,
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.method && filter.method in METHOD_LABELS ? { method: filter.method as PaymentMethod } : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" } },
              { reference: { contains: q.toUpperCase() } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    include: {
      customer: { select: { id: true, name: true, code: true } },
      allocations: { where: { reversedAt: null }, select: { amount: true } },
    },
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  return rows.map((p) => ({
    ...p,
    amount: p.amount.toFixed(2),
    unapplied:
      p.status === "POSTED"
        ? p.amount.minus(p.allocations.reduce((s, a) => s.plus(a.amount), toDecimal(0))).toFixed(2)
        : "0.00",
  }));
}

export async function getPayment(db: Db, actor: Actor, id: string) {
  authorize(actor, "sales.view");
  if (!isUuid(id)) throw new NotFoundError();
  const p = await db.payment.findUnique({
    where: { id },
    include: {
      customer: true,
      receivedBy: { select: { fullName: true } },
      reversedBy: { select: { fullName: true } },
      deletedBy: { select: { fullName: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: {
          invoice: { select: { id: true, number: true, total: true } },
          createdBy: { select: { fullName: true } },
        },
      },
    },
  });
  if (!p) throw new NotFoundError();
  const active = p.allocations.filter((a) => !a.reversedAt);
  const applied = active.reduce((s, a) => s.plus(a.amount), toDecimal(0));
  const journal = await db.journalEntry.findMany({
    where: { sourceId: p.id, sourceType: { in: ["Payment", "PaymentReversal"] } },
    select: { id: true, number: true, sourceType: true },
  });
  return {
    ...p,
    amount: p.amount.toFixed(2),
    applied: applied.toFixed(2),
    unapplied: p.status === "POSTED" ? p.amount.minus(applied).toFixed(2) : "0.00",
    allocations: p.allocations.map((a) => ({ ...a, amount: a.amount.toFixed(2) })),
    openInvoices: p.status === "POSTED" ? await openInvoices(db, p.customerId) : [],
    journal,
  };
}

// ─── Statements and ageing ──────────────────────────────────────────

export type StatementLine = {
  date: string;
  kind: "Invoice" | "Payment" | "Credit note" | "Reversal" | "Paid in old system" | "Opening balance";
  reference: string;
  href: string | null;
  debit: string;
  credit: string;
  balance: string;
};

/**
 * Everything on a customer's account in date order with a running balance.
 * Old-system invoices bring their old payments with them, so the balance
 * matches what the customer owes.
 */
export async function customerStatement(
  db: Db,
  actor: Actor,
  customerId: string,
  range: { from?: string; to?: string } = {},
) {
  authorize(actor, "customers.view");
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new NotFoundError();
  const [invoices, payments, creditNotes] = await Promise.all([
    db.salesDocument.findMany({
      where: { customerId, kind: "INVOICE", status: "POSTED" },
      include: { allocationsReceived: { where: { reversedAt: null, paymentId: { not: null } } } },
    }),
    // Deleted payments (and their reversal) are left off the statement altogether.
    db.payment.findMany({ where: { customerId, deletedAt: null } }),
    db.salesDocument.findMany({ where: { customerId, kind: "CREDIT_NOTE", status: "POSTED" } }),
  ]);
  type Row = Omit<StatementLine, "balance"> & { order: number };
  const rows: Row[] = [];
  for (const i of invoices) {
    const day = fromDbDate(i.issueDate);
    rows.push({
      date: day,
      kind: "Invoice",
      reference: i.number!,
      href: `/invoices/${i.id}`,
      debit: i.total.toFixed(2),
      credit: "0.00",
      order: 1,
    });
    if (i.historical) {
      const newPayments = i.allocationsReceived.reduce((s, a) => s.plus(a.amount), toDecimal(0));
      const old = i.amountPaid.minus(newPayments);
      if (old.greaterThan(0)) {
        rows.push({
          date: day,
          kind: "Paid in old system",
          reference: i.number!,
          href: `/invoices/${i.id}`,
          debit: "0.00",
          credit: old.toFixed(2),
          order: 2,
        });
      }
    }
  }
  for (const p of payments) {
    const day = fromDbDate(p.receivedOn);
    rows.push({
      date: day,
      kind: "Payment",
      reference: `${p.number} · ${METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ""}`,
      href: `/payments/${p.id}`,
      debit: "0.00",
      credit: p.amount.toFixed(2),
      order: 3,
    });
    if (p.status === "REVERSED" && p.reversedAt) {
      rows.push({
        date: todayInNairobi(p.reversedAt),
        kind: "Reversal",
        reference: `${p.number} reversed`,
        href: `/payments/${p.id}`,
        debit: p.amount.toFixed(2),
        credit: "0.00",
        order: 4,
      });
    }
  }
  for (const c of creditNotes) {
    rows.push({
      date: fromDbDate(c.issueDate),
      kind: "Credit note",
      reference: c.number!,
      href: `/credit-notes/${c.id}`,
      debit: "0.00",
      credit: c.total.toFixed(2),
      order: 3,
    });
  }
  rows.sort(
    (a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.reference.localeCompare(b.reference),
  );

  let balance = toDecimal(0);
  let opening = toDecimal(0);
  const lines: StatementLine[] = [];
  let totalDebit = toDecimal(0);
  let totalCredit = toDecimal(0);
  for (const r of rows) {
    balance = balance.plus(r.debit).minus(r.credit);
    if (range.from && r.date < range.from) {
      opening = balance;
      continue;
    }
    if (range.to && r.date > range.to) continue;
    totalDebit = totalDebit.plus(r.debit);
    totalCredit = totalCredit.plus(r.credit);
    lines.push({
      date: r.date,
      kind: r.kind,
      reference: r.reference,
      href: r.href,
      debit: r.debit,
      credit: r.credit,
      balance: balance.toFixed(2),
    });
  }
  const closing = opening.plus(totalDebit).minus(totalCredit);
  return {
    customer: { ...customer, creditLimit: customer.creditLimit.toFixed(2) },
    from: range.from ?? null,
    to: range.to ?? todayInNairobi(),
    opening: opening.toFixed(2),
    lines,
    totalDebit: totalDebit.toFixed(2),
    totalCredit: totalCredit.toFixed(2),
    closing: closing.toFixed(2),
  };
}

const BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

/** Who owes what, by how overdue it is (from the due date). */
export async function agedReceivables(db: Db, actor: Actor, asOf: string = todayInNairobi()) {
  authorize(actor, "customers.view");
  const invoices = await db.salesDocument.findMany({
    where: { kind: "INVOICE", status: "POSTED" },
    select: {
      customerId: true,
      issueDate: true,
      dueDate: true,
      total: true,
      amountPaid: true,
      amountCredited: true,
      customer: { select: { name: true, code: true, phone: true } },
    },
  });
  const by = new Map<
    string,
    {
      customerId: string;
      name: string;
      code: string;
      phone: string | null;
      buckets: ReturnType<typeof toDecimal>[];
      credit: string;
    }
  >();
  const ref = toDbDate(asOf).getTime();
  for (const i of invoices) {
    const out = i.total.minus(i.amountPaid).minus(i.amountCredited);
    if (out.lessThanOrEqualTo(0)) continue;
    const due = (i.dueDate ?? i.issueDate).getTime();
    const days = Math.floor((ref - due) / 86_400_000);
    const b = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    const row = by.get(i.customerId) ?? {
      customerId: i.customerId,
      name: i.customer.name,
      code: i.customer.code,
      phone: i.customer.phone,
      buckets: BUCKETS.map(() => toDecimal(0)),
      credit: "0.00",
    };
    row.buckets[b] = row.buckets[b]!.plus(out);
    by.set(i.customerId, row);
  }
  type AgedRow = {
    customerId: string;
    name: string;
    code: string;
    phone: string | null;
    buckets: string[];
    owed: string;
    credit: string;
    net: string;
  };
  const rows: AgedRow[] = [];
  for (const r of by.values()) {
    const bal = await customerBalance(db, r.customerId);
    const owed = r.buckets.reduce((s, x) => s.plus(x), toDecimal(0));
    rows.push({
      ...r,
      buckets: r.buckets.map((x) => x.toFixed(2)),
      owed: owed.toFixed(2),
      credit: bal.unappliedCredit,
      net: bal.balance,
    });
  }
  rows.sort((a, b) => toDecimal(b.owed).comparedTo(toDecimal(a.owed)));
  const totals = BUCKETS.map((_, k) => rows.reduce((s, r) => s.plus(r.buckets[k]!), toDecimal(0)).toFixed(2));
  return {
    asOf,
    buckets: BUCKETS,
    rows,
    totals,
    total: rows.reduce((s, r) => s.plus(r.owed), toDecimal(0)).toFixed(2),
  };
}
