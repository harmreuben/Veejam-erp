import "server-only";

import type Decimal from "decimal.js";

import type { Prisma } from "@/generated/prisma/client";
import { addDays, daysBetween, fromDbDate, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assertBooksOpen,
  METHOD_ACCOUNT,
  postJournal,
  reverseJournalOf,
  SUBLEDGER_ACCOUNTS,
  type JournalLineInput,
} from "@/server/modules/accounting/journal";
import { isUniqueViolation } from "@/server/modules/inventory/stock";
import { METHOD_LABELS, reverseSchema } from "@/server/modules/payments/schemas";
import type { AuditContext } from "@/server/modules/pricing/service";
import { isUuid, parseInput } from "@/server/shared/validation";

import { billSchema, supplierPaymentSchema } from "./schemas";

const auditBase = (actor: Actor, ctx: AuditContext) => ({
  actorUserId: actor.id,
  actorLabel: actor.email,
  ...ctx,
});

const zero = () => toDecimal(0);

async function lockSupplier(tx: DbOrTx, id: string) {
  if (!isUuid(id)) throw new ValidationError({ supplierId: ["Choose a supplier"] });
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM suppliers WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new ValidationError({ supplierId: ["Choose a supplier"] });
  return tx.supplier.findUniqueOrThrow({ where: { id } });
}

/** Money paid to a supplier that isn't applied to a bill yet, oldest first. */
async function unappliedPayments(tx: DbOrTx, supplierId: string) {
  const payments = await tx.supplierPayment.findMany({
    where: { supplierId, status: "POSTED" },
    include: { allocations: { where: { reversedAt: null } } },
    orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
  });
  return payments
    .map((p) => ({
      id: p.id,
      number: p.number,
      left: p.amount.minus(p.allocations.reduce((s, a) => s.plus(a.amount), zero())),
    }))
    .filter((p) => p.left.greaterThan(0));
}

async function openBillsTx(tx: DbOrTx, supplierId: string) {
  const bills = await tx.supplierBill.findMany({
    where: { supplierId, status: "POSTED" },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }, { number: "asc" }],
  });
  return bills
    .map((b) => ({ ...b, outstanding: b.total.minus(b.amountPaid) }))
    .filter((b) => b.outstanding.greaterThan(0));
}

// ─── Supplier bills ─────────────────────────────────────────────────

export type BillResult = { id: string; number: string; alreadyPosted: boolean; creditApplied: string };

/**
 * Enter a supplier's invoice (BILL-). It can cover goods already received
 * (each GRN once) and/or expenses such as transport. Posts:
 *   Dr Goods received not yet billed (at the GRNs' cost), Dr expenses,
 *   Dr VAT recoverable, Dr/Cr Purchase price differences (bill vs GRN cost),
 *   Cr Accounts payable.
 * Money already paid to the supplier in advance is applied to it straight away.
 */
export async function postSupplierBill(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<BillResult> {
  authorize(actor, "bills.manage");
  const v = parseInput(billSchema, input);
  const existing = await db.supplierBill.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
  if (existing)
    return { id: existing.id, number: existing.number, alreadyPosted: true, creditApplied: "0.00" };

  try {
    return await db.$transaction(
      async (tx) => {
        const supplier = await lockSupplier(tx, v.supplierId);
        await assertBooksOpen(tx, v.billDate);
        const errors: Record<string, string[]> = {};
        if (v.billDate > todayInNairobi()) errors.billDate = ["Can't be in the future"];
        const dueDate = v.dueDate ?? addDays(v.billDate, supplier.paymentTermsDays);
        if (dueDate < v.billDate) errors.dueDate = ["Can't be before the bill date"];
        const duplicate = await tx.supplierBill.findFirst({
          where: {
            supplierId: supplier.id,
            supplierInvoiceNumber: v.supplierInvoiceNumber,
            status: "POSTED",
          },
          select: { number: true },
        });
        if (duplicate) {
          errors.supplierInvoiceNumber = [
            `${supplier.name}'s invoice ${v.supplierInvoiceNumber} is already entered as ${duplicate.number}`,
          ];
        }
        if (!v.receipts.length && !v.expenses.length)
          errors.form = ["Add the goods received or an expense line"];

        // Goods received: each GRN once, this supplier's, not billed yet. Locked so two bills can't take it.
        const grnIds = v.receipts.map((r) => r.goodsReceiptId);
        if (new Set(grnIds).size !== grnIds.length) errors.form = ["A goods received note is listed twice"];
        for (const id of [...grnIds].sort()) {
          await tx.$queryRaw`SELECT id FROM goods_receipts WHERE id = ${id}::uuid FOR UPDATE`;
        }
        const grns = await tx.goodsReceipt.findMany({ where: { id: { in: grnIds } } });
        v.receipts.forEach((r, i) => {
          const g = grns.find((x) => x.id === r.goodsReceiptId);
          if (!g || g.supplierId !== supplier.id) errors[`receipts.${i}.net`] = ["Not from this supplier"];
          else if (g.billId) errors[`receipts.${i}.net`] = [`${g.number} is already on another bill`];
        });

        const accountIds = [...new Set(v.expenses.map((e) => e.accountId))];
        const accounts = await tx.account.findMany({ where: { id: { in: accountIds } } });
        v.expenses.forEach((e, i) => {
          const a = accounts.find((x) => x.id === e.accountId);
          if (
            !a ||
            a.status !== "ACTIVE" ||
            (a.type !== "EXPENSE" && a.type !== "ASSET") ||
            (a.systemKey &&
              ((SUBLEDGER_ACCOUNTS as readonly string[]).includes(a.systemKey) ||
                a.systemKey === "VAT_INPUT"))
          ) {
            errors[`expenses.${i}.accountId`] = ["Choose an expense or asset account"];
          }
        });
        if (Object.keys(errors).length) throw new ValidationError(errors);

        const lines = [
          ...v.receipts.map((r) => {
            const g = grns.find((x) => x.id === r.goodsReceiptId)!;
            const net = toDecimal(r.net!);
            const tax = toDecimal(r.tax!);
            return {
              kind: "GOODS" as const,
              goodsReceiptId: g.id,
              accountId: null,
              description: `Goods received ${g.number}${g.supplierReference ? ` (${g.supplierReference})` : ""}`,
              net,
              tax,
              grnCost: g.totalCost,
            };
          }),
          ...v.expenses.map((e) => ({
            kind: "EXPENSE" as const,
            goodsReceiptId: null,
            accountId: e.accountId,
            description: e.description,
            net: toDecimal(e.net!),
            tax: toDecimal(e.tax ?? "0"),
            grnCost: null,
          })),
        ];
        const subtotal = lines.reduce((s, l) => s.plus(l.net), zero());
        const taxTotal = lines.reduce((s, l) => s.plus(l.tax), zero());
        const total = subtotal.plus(taxTotal);
        if (!total.greaterThan(0))
          throw new ValidationError({ form: ["The bill's total must be more than zero"] });

        const number = await nextNumber(tx, "SUPPLIER_BILL");
        const bill = await tx.supplierBill.create({
          data: {
            number,
            supplierId: supplier.id,
            supplierInvoiceNumber: v.supplierInvoiceNumber,
            billDate: toDbDate(v.billDate),
            dueDate: toDbDate(dueDate),
            subtotal: subtotal.toFixed(2),
            taxTotal: taxTotal.toFixed(2),
            total: total.toFixed(2),
            notes: v.notes,
            idempotencyKey: v.idempotencyKey,
            postedById: actor.id,
            lines: {
              create: lines.map((l, i) => ({
                position: i + 1,
                kind: l.kind,
                goodsReceiptId: l.goodsReceiptId,
                accountId: l.accountId,
                description: l.description,
                netAmount: l.net.toFixed(2),
                taxAmount: l.tax.toFixed(2),
                grossAmount: l.net.plus(l.tax).toFixed(2),
              })),
            },
          },
        });
        if (grnIds.length)
          await tx.goodsReceipt.updateMany({ where: { id: { in: grnIds } }, data: { billId: bill.id } });

        const goods = lines.filter((l) => l.kind === "GOODS");
        const grnCost = goods.reduce((s, l) => s.plus(l.grnCost!), zero());
        const goodsNet = goods.reduce((s, l) => s.plus(l.net), zero());
        const diff = goodsNet.minus(grnCost);
        const journalLines: JournalLineInput[] = [
          { account: "GRNI", debit: grnCost.toFixed(2) },
          ...(diff.greaterThan(0)
            ? [
                {
                  account: "PRICE_DIFF" as const,
                  debit: diff.toFixed(2),
                  description: "Billed above the cost on receipt",
                },
              ]
            : diff.lessThan(0)
              ? [
                  {
                    account: "PRICE_DIFF" as const,
                    credit: diff.negated().toFixed(2),
                    description: "Billed below the cost on receipt",
                  },
                ]
              : []),
          ...lines
            .filter((l) => l.kind === "EXPENSE")
            .map((l) => ({
              account: { id: l.accountId! },
              debit: l.net.toFixed(2),
              description: l.description,
            })),
          { account: "VAT_INPUT", debit: taxTotal.toFixed(2) },
          { account: "AP", credit: total.toFixed(2) },
        ];
        await postJournal(tx, {
          date: v.billDate,
          description: `Bill ${number} — ${supplier.name} invoice ${v.supplierInvoiceNumber}`,
          sourceType: "SupplierBill",
          sourceId: bill.id,
          sourceNumber: number,
          actorId: actor.id,
          lines: journalLines,
        });

        // Apply money already paid in advance.
        let left = total;
        let applied = zero();
        for (const p of await unappliedPayments(tx, supplier.id)) {
          if (!left.greaterThan(0)) break;
          const take = p.left.lessThan(left) ? p.left : left;
          await tx.supplierPaymentAllocation.create({
            data: { paymentId: p.id, billId: bill.id, amount: take.toFixed(2) },
          });
          left = left.minus(take);
          applied = applied.plus(take);
        }
        if (applied.greaterThan(0)) {
          await tx.supplierBill.update({ where: { id: bill.id }, data: { amountPaid: applied.toFixed(2) } });
        }

        await writeAudit(tx, {
          ...auditBase(actor, ctx),
          action: "SUPPLIER_BILL_POSTED",
          entityType: "SupplierBill",
          entityId: bill.id,
          summary:
            `${number}: ${supplier.name} invoice ${v.supplierInvoiceNumber}, ${formatKES(total.toFixed(2))}` +
            (diff.isZero()
              ? ""
              : `, ${formatKES(diff.abs().toFixed(2))} ${diff.isNegative() ? "below" : "above"} cost on receipt`) +
            (applied.greaterThan(0) ? `, ${formatKES(applied.toFixed(2))} paid from earlier payments` : ""),
        });
        return { id: bill.id, number, alreadyPosted: false, creditApplied: applied.toFixed(2) };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.supplierBill.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number, alreadyPosted: true, creditApplied: "0.00" };
    }
    throw error;
  }
}

/**
 * Cancel a bill entered by mistake. Its journal entry is reversed, its goods
 * received notes can be billed again, and any money applied to it goes back
 * to being credit with the supplier.
 */
export async function cancelSupplierBill(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "bills.manage");
  const v = parseInput(reverseSchema, input);
  if (!isUuid(id)) throw new NotFoundError();
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM supplier_bills WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundError();
    const bill = await tx.supplierBill.findUniqueOrThrow({
      where: { id },
      include: { supplier: true, allocations: { where: { reversedAt: null } } },
    });
    if (bill.version !== v.version)
      throw new ConflictError(`${bill.number} was changed by someone else. Reload the page.`);
    if (bill.status !== "POSTED") throw new ConflictError(`${bill.number} is already cancelled.`);
    const today = todayInNairobi();
    await assertBooksOpen(tx, today);
    if (bill.allocations.length) {
      await tx.supplierPaymentAllocation.updateMany({
        where: { id: { in: bill.allocations.map((a) => a.id) } },
        data: { reversedAt: new Date() },
      });
    }
    await tx.goodsReceipt.updateMany({ where: { billId: id }, data: { billId: null } });
    await tx.supplierBill.update({
      where: { id },
      data: {
        status: "CANCELLED",
        amountPaid: "0",
        cancelledAt: new Date(),
        cancelledById: actor.id,
        cancelReason: v.reason,
        version: { increment: 1 },
      },
    });
    await reverseJournalOf(
      tx,
      { type: "SupplierBill", id },
      {
        date: today,
        description: `Cancelled bill ${bill.number} (${bill.supplier.name}): ${v.reason}`,
        sourceType: "SupplierBillCancelled",
        sourceNumber: bill.number,
        actorId: actor.id,
      },
    );
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SUPPLIER_BILL_CANCELLED",
      entityType: "SupplierBill",
      entityId: id,
      summary: `${bill.number} (${bill.supplier.name}, ${formatKES(bill.total.toFixed(2))}) cancelled: ${v.reason}`,
    });
    return {
      number: bill.number,
      released: bill.allocations.reduce((s, a) => s.plus(a.amount), zero()).toFixed(2),
    };
  });
}

// ─── Supplier payments ──────────────────────────────────────────────

export type SupplierPaymentResult = {
  id: string;
  number: string;
  alreadyRecorded: boolean;
  applied: string;
  credit: string;
};

/**
 * Pay a supplier (SPAY-): Dr Accounts payable, Cr Cash / M-Pesa / Bank.
 * Applied to the oldest bills first, or to the amounts chosen; anything left
 * is kept as credit and applied to the next bill automatically.
 */
export async function recordSupplierPayment(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<SupplierPaymentResult> {
  authorize(actor, "supplier_payments.manage");
  const v = parseInput(supplierPaymentSchema, input);
  const existing = await db.supplierPayment.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
  if (existing)
    return {
      id: existing.id,
      number: existing.number,
      alreadyRecorded: true,
      applied: "0.00",
      credit: "0.00",
    };

  try {
    return await db.$transaction(async (tx) => {
      const supplier = await lockSupplier(tx, v.supplierId);
      if (v.paidOn > todayInNairobi()) throw new ValidationError({ paidOn: ["Can't be in the future"] });
      await assertBooksOpen(tx, v.paidOn);
      if (v.reference) {
        const dup = await tx.supplierPayment.findFirst({
          where: { method: v.method, reference: v.reference, status: "POSTED" },
          select: { number: true },
        });
        if (dup)
          throw new ValidationError({ reference: [`${v.reference} was already recorded on ${dup.number}`] });
      }
      const bills = await openBillsTx(tx, supplier.id);
      const amount = toDecimal(v.amount);
      let plan: { billId: string; amount: Decimal }[] = [];
      if (v.allocate === "manual") {
        const errors: Record<string, string[]> = {};
        v.allocations.forEach((a, i) => {
          const b = bills.find((x) => x.id === a.billId);
          if (!b)
            errors[`allocations.${i}.amount`] = ["This bill is already paid or cancelled. Reload the page."];
          else if (toDecimal(a.amount).greaterThan(b.outstanding))
            errors[`allocations.${i}.amount`] = [
              `Only ${formatKES(b.outstanding.toFixed(2))} is owed on ${b.number}`,
            ];
        });
        if (Object.keys(errors).length) throw new ValidationError(errors);
        plan = v.allocations.map((a) => ({ billId: a.billId, amount: toDecimal(a.amount) }));
        const sum = plan.reduce((s, a) => s.plus(a.amount), zero());
        if (sum.greaterThan(amount)) {
          throw new ValidationError({
            allocations: [
              `That applies ${formatKES(sum.toFixed(2))}, more than the ${formatKES(v.amount)} paid`,
            ],
          });
        }
      } else {
        let left = amount;
        for (const b of bills) {
          if (!left.greaterThan(0)) break;
          const take = b.outstanding.lessThan(left) ? b.outstanding : left;
          plan.push({ billId: b.id, amount: take });
          left = left.minus(take);
        }
      }

      const number = await nextNumber(tx, "SUPPLIER_PAYMENT");
      const payment = await tx.supplierPayment.create({
        data: {
          number,
          supplierId: supplier.id,
          paidOn: toDbDate(v.paidOn),
          method: v.method,
          reference: v.reference,
          amount: v.amount,
          notes: v.notes,
          idempotencyKey: v.idempotencyKey,
          paidById: actor.id,
        },
      });
      for (const a of plan) {
        await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id = ${a.billId}::uuid FOR UPDATE`;
        await tx.supplierPaymentAllocation.create({
          data: { paymentId: payment.id, billId: a.billId, amount: a.amount.toFixed(2) },
        });
        await tx.supplierBill.update({
          where: { id: a.billId },
          data: { amountPaid: { increment: a.amount.toFixed(2) } },
        });
      }
      await postJournal(tx, {
        date: v.paidOn,
        description: `Payment ${number} to ${supplier.name} (${METHOD_LABELS[v.method]}${v.reference ? ` ${v.reference}` : ""})`,
        sourceType: "SupplierPayment",
        sourceId: payment.id,
        sourceNumber: number,
        actorId: actor.id,
        lines: [
          { account: "AP", debit: v.amount },
          { account: METHOD_ACCOUNT[v.method], credit: v.amount },
        ],
      });
      const applied = plan.reduce((s, a) => s.plus(a.amount), zero());
      const credit = amount.minus(applied);
      await writeAudit(tx, {
        ...auditBase(actor, ctx),
        action: "SUPPLIER_PAYMENT_RECORDED",
        entityType: "SupplierPayment",
        entityId: payment.id,
        summary:
          `${number}: ${formatKES(v.amount)} to ${supplier.name} by ${METHOD_LABELS[v.method]}` +
          (credit.greaterThan(0) ? `, ${formatKES(credit.toFixed(2))} kept as credit` : ""),
      });
      return {
        id: payment.id,
        number,
        alreadyRecorded: false,
        applied: applied.toFixed(2),
        credit: credit.toFixed(2),
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.supplierPayment.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
      if (winner)
        return {
          id: winner.id,
          number: winner.number,
          alreadyRecorded: true,
          applied: "0.00",
          credit: "0.00",
        };
    }
    throw error;
  }
}

export async function reverseSupplierPayment(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "supplier_payments.manage");
  const v = parseInput(reverseSchema, input);
  if (!isUuid(id)) throw new NotFoundError();
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM supplier_payments WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new NotFoundError();
    const p = await tx.supplierPayment.findUniqueOrThrow({
      where: { id },
      include: { allocations: { where: { reversedAt: null } }, supplier: true },
    });
    if (p.version !== v.version)
      throw new ConflictError(`${p.number} was changed by someone else. Reload the page.`);
    if (p.status !== "POSTED") throw new ConflictError(`${p.number} is already reversed.`);
    const today = todayInNairobi();
    for (const a of p.allocations) {
      await tx.$queryRaw`SELECT id FROM supplier_bills WHERE id = ${a.billId}::uuid FOR UPDATE`;
      await tx.supplierPaymentAllocation.update({ where: { id: a.id }, data: { reversedAt: new Date() } });
      await tx.supplierBill.update({
        where: { id: a.billId },
        data: { amountPaid: { decrement: a.amount } },
      });
    }
    await tx.supplierPayment.update({
      where: { id },
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedById: actor.id,
        reverseReason: v.reason,
        version: { increment: 1 },
      },
    });
    const amount = p.amount.toFixed(2);
    await postJournal(tx, {
      date: today,
      description: `Reversal of payment ${p.number} to ${p.supplier.name}: ${v.reason}`,
      sourceType: "SupplierPaymentReversal",
      sourceId: p.id,
      sourceNumber: p.number,
      actorId: actor.id,
      lines: [
        { account: METHOD_ACCOUNT[p.method], debit: amount },
        { account: "AP", credit: amount },
      ],
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SUPPLIER_PAYMENT_REVERSED",
      entityType: "SupplierPayment",
      entityId: id,
      summary: `${p.number} (${formatKES(amount)} to ${p.supplier.name}) reversed: ${v.reason}`,
    });
  });
}

// ─── Reading ────────────────────────────────────────────────────────

/** What VeeJam owes a supplier: unpaid bills less money paid in advance. */
export async function supplierBalance(db: DbOrTx, supplierId: string) {
  const [bills, credit] = await Promise.all([openBillsTx(db, supplierId), unappliedPayments(db, supplierId)]);
  const owed = bills.reduce((s, b) => s.plus(b.outstanding), zero());
  const advance = credit.reduce((s, p) => s.plus(p.left), zero());
  return {
    owedOnBills: owed.toFixed(2),
    paidInAdvance: advance.toFixed(2),
    balance: owed.minus(advance).toFixed(2),
    openBills: bills.length,
  };
}

export async function openBills(db: Db, actor: Actor, supplierId: string) {
  authorize(actor, "payables.view");
  const bills = await openBillsTx(db, supplierId);
  return bills.map((b) => ({
    id: b.id,
    number: b.number,
    supplierInvoiceNumber: b.supplierInvoiceNumber,
    billDate: fromDbDate(b.billDate),
    dueDate: fromDbDate(b.dueDate),
    total: b.total.toFixed(2),
    outstanding: b.outstanding.toFixed(2),
  }));
}

export async function listBills(
  db: Db,
  actor: Actor,
  filter: { q?: string; status?: string; supplierId?: string } = {},
) {
  authorize(actor, "payables.view");
  const where: Prisma.SupplierBillWhereInput = {};
  if (filter.status === "UNPAID") where.status = "POSTED";
  else if (filter.status === "CANCELLED") where.status = "CANCELLED";
  if (filter.supplierId && isUuid(filter.supplierId)) where.supplierId = filter.supplierId;
  if (filter.q) {
    where.OR = [
      { number: { contains: filter.q, mode: "insensitive" } },
      { supplierInvoiceNumber: { contains: filter.q, mode: "insensitive" } },
      { supplier: { name: { contains: filter.q, mode: "insensitive" } } },
    ];
  }
  const today = todayInNairobi();
  const rows = await db.supplierBill.findMany({
    where,
    include: { supplier: { select: { name: true } } },
    orderBy: [{ billDate: "desc" }, { number: "desc" }],
    take: 300,
  });
  return rows
    .map((b) => {
      const outstanding = b.status === "POSTED" ? b.total.minus(b.amountPaid) : zero();
      const due = fromDbDate(b.dueDate);
      return {
        id: b.id,
        number: b.number,
        supplier: b.supplier.name,
        supplierInvoiceNumber: b.supplierInvoiceNumber,
        billDate: fromDbDate(b.billDate),
        dueDate: due,
        total: b.total.toFixed(2),
        outstanding: outstanding.toFixed(2),
        state:
          b.status === "CANCELLED"
            ? ("CANCELLED" as const)
            : outstanding.isZero()
              ? ("PAID" as const)
              : due < today
                ? ("OVERDUE" as const)
                : b.amountPaid.greaterThan(0)
                  ? ("PART_PAID" as const)
                  : ("UNPAID" as const),
      };
    })
    .filter((b) => filter.status !== "UNPAID" || b.state !== "PAID");
}

export async function getBill(db: Db, actor: Actor, id: string) {
  authorize(actor, "payables.view");
  if (!isUuid(id)) throw new NotFoundError();
  const b = await db.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      postedBy: { select: { fullName: true } },
      cancelledBy: { select: { fullName: true } },
      lines: {
        orderBy: { position: "asc" },
        include: {
          account: { select: { code: true, name: true } },
          goodsReceipt: { select: { id: true, number: true, totalCost: true } },
        },
      },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: { payment: { select: { id: true, number: true, method: true, paidOn: true } } },
      },
    },
  });
  if (!b) throw new NotFoundError();
  return {
    ...b,
    billDate: fromDbDate(b.billDate),
    dueDate: fromDbDate(b.dueDate),
    outstanding: b.status === "POSTED" ? b.total.minus(b.amountPaid).toFixed(2) : "0.00",
  };
}

/** Unbilled goods received and expense accounts, for the bill form. */
export async function billFormData(db: Db, actor: Actor, supplierId: string | null) {
  authorize(actor, "bills.manage");
  const [suppliers, accounts] = await Promise.all([
    db.supplier.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, paymentTermsDays: true },
    }),
    db.account.findMany({
      where: {
        status: "ACTIVE",
        type: { in: ["EXPENSE", "ASSET"] },
        OR: [
          { systemKey: null },
          { systemKey: { notIn: [...SUBLEDGER_ACCOUNTS, "VAT_INPUT", "CASH", "MPESA", "BANK"] } },
        ],
      },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const receipts =
    supplierId && isUuid(supplierId)
      ? await db.goodsReceipt.findMany({
          where: { supplierId, billId: null },
          orderBy: { receivedOn: "asc" },
          select: {
            id: true,
            number: true,
            receivedOn: true,
            supplierReference: true,
            totalCost: true,
            expectedTax: true,
          },
        })
      : [];
  return {
    today: todayInNairobi(),
    suppliers,
    accounts,
    receipts: receipts.map((r) => ({
      id: r.id,
      number: r.number,
      receivedOn: fromDbDate(r.receivedOn),
      supplierReference: r.supplierReference,
      cost: r.totalCost.toFixed(2),
      expectedTax: r.expectedTax.toFixed(2),
    })),
  };
}

export async function listSupplierPayments(
  db: Db,
  actor: Actor,
  filter: { q?: string; supplierId?: string } = {},
) {
  authorize(actor, "payables.view");
  const where: Prisma.SupplierPaymentWhereInput = {};
  if (filter.supplierId && isUuid(filter.supplierId)) where.supplierId = filter.supplierId;
  if (filter.q) {
    where.OR = [
      { number: { contains: filter.q, mode: "insensitive" } },
      { reference: { contains: filter.q, mode: "insensitive" } },
      { supplier: { name: { contains: filter.q, mode: "insensitive" } } },
    ];
  }
  const rows = await db.supplierPayment.findMany({
    where,
    include: { supplier: { select: { name: true } } },
    orderBy: [{ paidOn: "desc" }, { number: "desc" }],
    take: 300,
  });
  return rows.map((p) => ({
    id: p.id,
    number: p.number,
    supplier: p.supplier.name,
    paidOn: fromDbDate(p.paidOn),
    method: p.method,
    reference: p.reference,
    amount: p.amount.toFixed(2),
    status: p.status,
  }));
}

export async function getSupplierPayment(db: Db, actor: Actor, id: string) {
  authorize(actor, "payables.view");
  if (!isUuid(id)) throw new NotFoundError();
  const p = await db.supplierPayment.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      paidBy: { select: { fullName: true } },
      reversedBy: { select: { fullName: true } },
      allocations: {
        orderBy: { createdAt: "asc" },
        include: { bill: { select: { id: true, number: true, supplierInvoiceNumber: true, total: true } } },
      },
    },
  });
  if (!p) throw new NotFoundError();
  const active = p.allocations.filter((a) => !a.reversedAt);
  const applied = active.reduce((s, a) => s.plus(a.amount), zero());
  return {
    ...p,
    paidOn: fromDbDate(p.paidOn),
    applied: applied.toFixed(2),
    unapplied: p.status === "POSTED" ? p.amount.minus(applied).toFixed(2) : "0.00",
  };
}

/** What VeeJam owes each supplier, by how overdue it is. */
export async function agedPayables(db: Db, actor: Actor, asOf: string = todayInNairobi()) {
  authorize(actor, "payables.view");
  const [bills, suppliers] = await Promise.all([
    db.supplierBill.findMany({
      where: { status: "POSTED" },
      select: { supplierId: true, dueDate: true, total: true, amountPaid: true },
    }),
    db.supplier.findMany({ select: { id: true, name: true, code: true } }),
  ]);
  type Row = {
    id: string;
    name: string;
    code: string;
    current: Decimal;
    d30: Decimal;
    d60: Decimal;
    d90: Decimal;
    over90: Decimal;
    advance: Decimal;
  };
  const rows = new Map<string, Row>();
  const rowFor = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const s = suppliers.find((x) => x.id === id)!;
      r = {
        id,
        name: s.name,
        code: s.code,
        current: zero(),
        d30: zero(),
        d60: zero(),
        d90: zero(),
        over90: zero(),
        advance: zero(),
      };
      rows.set(id, r);
    }
    return r;
  };
  for (const b of bills) {
    const out = b.total.minus(b.amountPaid);
    if (!out.greaterThan(0)) continue;
    const late = daysBetween(fromDbDate(b.dueDate), asOf);
    const r = rowFor(b.supplierId);
    if (late <= 0) r.current = r.current.plus(out);
    else if (late <= 30) r.d30 = r.d30.plus(out);
    else if (late <= 60) r.d60 = r.d60.plus(out);
    else if (late <= 90) r.d90 = r.d90.plus(out);
    else r.over90 = r.over90.plus(out);
  }
  for (const s of suppliers) {
    const advance = (await unappliedPayments(db, s.id)).reduce((t, p) => t.plus(p.left), zero());
    if (advance.greaterThan(0)) rowFor(s.id).advance = advance;
  }
  const list = [...rows.values()]
    .map((r) => {
      const total = r.current.plus(r.d30).plus(r.d60).plus(r.d90).plus(r.over90).minus(r.advance);
      return {
        id: r.id,
        name: r.name,
        code: r.code,
        current: r.current.toFixed(2),
        d30: r.d30.toFixed(2),
        d60: r.d60.toFixed(2),
        d90: r.d90.toFixed(2),
        over90: r.over90.toFixed(2),
        advance: r.advance.toFixed(2),
        total: total.toFixed(2),
      };
    })
    .sort((a, b) => toDecimal(b.total).comparedTo(toDecimal(a.total)));
  const sum = (k: "current" | "d30" | "d60" | "d90" | "over90" | "advance" | "total") =>
    list.reduce((s, r) => s.plus(r[k]), zero()).toFixed(2);
  return {
    asOf,
    rows: list,
    totals: {
      current: sum("current"),
      d30: sum("d30"),
      d60: sum("d60"),
      d90: sum("d90"),
      over90: sum("over90"),
      advance: sum("advance"),
      total: sum("total"),
    },
  };
}

/** Bills and payments with a running balance (what VeeJam owes the supplier). */
export async function supplierStatement(db: Db, actor: Actor, supplierId: string) {
  authorize(actor, "payables.view");
  if (!isUuid(supplierId)) throw new NotFoundError();
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw new NotFoundError();
  const [bills, payments] = await Promise.all([
    db.supplierBill.findMany({ where: { supplierId, status: "POSTED" } }),
    db.supplierPayment.findMany({ where: { supplierId, status: "POSTED" } }),
  ]);
  const entries = [
    ...bills.map((b) => ({
      date: fromDbDate(b.billDate),
      at: b.postedAt,
      kind: "Bill" as const,
      id: b.id,
      reference: `${b.number} · invoice ${b.supplierInvoiceNumber}`,
      charged: b.total,
      paid: zero(),
    })),
    ...payments.map((p) => ({
      date: fromDbDate(p.paidOn),
      at: p.createdAt,
      kind: "Payment" as const,
      id: p.id,
      reference: `${p.number} · ${METHOD_LABELS[p.method]}${p.reference ? ` ${p.reference}` : ""}`,
      charged: zero(),
      paid: p.amount,
    })),
  ].sort((a, b) => (a.date === b.date ? a.at.getTime() - b.at.getTime() : a.date < b.date ? -1 : 1));
  let running = zero();
  const rows = entries.map((e) => {
    running = running.plus(e.charged).minus(e.paid);
    return { ...e, charged: e.charged.toFixed(2), paid: e.paid.toFixed(2), balance: running.toFixed(2) };
  });
  return {
    supplier: { id: supplier.id, name: supplier.name, code: supplier.code },
    rows,
    balance: running.toFixed(2),
    totals: {
      charged: bills.reduce((s, b) => s.plus(b.total), zero()).toFixed(2),
      paid: payments.reduce((s, p) => s.plus(p.amount), zero()).toFixed(2),
    },
  };
}
