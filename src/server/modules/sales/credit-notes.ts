import "server-only";

import type { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { calculateLine, sumLines } from "@/lib/sales-math";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertBooksOpen, postJournal } from "@/server/modules/accounting/journal";
import { applyStockChanges, isUniqueViolation } from "@/server/modules/inventory/stock";
import { creditNoteSchema } from "@/server/modules/payments/schemas";
import type { AuditContext } from "@/server/modules/pricing/service";
import { isUuid, parseInput } from "@/server/shared/validation";

const lineKey = (l: { productId: string; unit: string }) => `${l.productId}|${l.unit}`;

/** What can still be credited on each line of a posted invoice. */
export async function creditableLines(db: Db, actor: Actor, invoiceId: string) {
  authorize(actor, "sales.view");
  if (!isUuid(invoiceId)) throw new NotFoundError();
  const invoice = await db.salesDocument.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { name: true, code: true } },
      lines: { orderBy: { position: "asc" } },
      derivedDocuments: {
        where: { kind: "CREDIT_NOTE", status: "POSTED" },
        include: { lines: true },
      },
    },
  });
  if (!invoice || invoice.kind !== "INVOICE") throw new NotFoundError();
  const credited = new Map<string, number>();
  for (const cn of invoice.derivedDocuments) {
    for (const l of cn.lines) credited.set(lineKey(l), (credited.get(lineKey(l)) ?? 0) + l.quantity);
  }
  const alreadyCredited = invoice.derivedDocuments.reduce((s, c) => s.plus(c.total), toDecimal(0));
  return {
    invoice: {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      historical: invoice.historical,
      customer: invoice.customer,
      total: invoice.total.toFixed(2),
      outstanding: invoice.total.minus(invoice.amountPaid).minus(invoice.amountCredited).toFixed(2),
      alreadyCredited: alreadyCredited.toFixed(2),
    },
    lines: invoice.lines.map((l) => ({
      id: l.id,
      sku: l.sku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toFixed(2),
      grossAmount: l.grossAmount.toFixed(2),
      remaining: l.quantity - Math.min(l.quantity, credited.get(lineKey(l)) ?? 0),
    })),
  };
}

/**
 * Issue a credit note against a posted invoice, in one transaction:
 * lines are credited at the invoice's own prices and VAT; it is applied to the
 * invoice's unpaid balance first and anything left becomes credit on the
 * customer's account; returned goods can go back into stock; and the journal
 * gets Dr sales returns and VAT, Cr receivables. Sending the same form twice
 * issues one credit note.
 */
export async function createCreditNote(
  db: Db,
  actor: Actor,
  invoiceId: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<{ id: string; number: string; alreadyIssued: boolean }> {
  authorize(actor, "credit_notes.manage");
  const v = parseInput(creditNoteSchema, input);
  const wanted = v.lines.filter((l) => l.quantity > 0);
  if (!wanted.length)
    throw new ValidationError({ lines: ["Enter a quantity to credit on at least one line"] });

  const existing = await db.salesDocument.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
  if (existing) return { id: existing.id, number: existing.number!, alreadyIssued: true };

  try {
    return await db.$transaction(async (tx) => {
      const r = await issueCreditNote(tx, actor, invoiceId, v, ctx);
      return { id: r.id, number: r.number, alreadyIssued: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.salesDocument.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number!, alreadyIssued: true };
    }
    throw error;
  }
}

export type CreditNoteInput = z.output<typeof creditNoteSchema>;

/**
 * Issue a credit note inside the caller's transaction (see createCreditNote).
 * `replaces` links a correction to the credit note it replaces, which the
 * caller has already undone.
 */
export async function issueCreditNote(
  tx: Prisma.TransactionClient,
  actor: Actor,
  invoiceId: string,
  v: CreditNoteInput,
  ctx: AuditContext,
  replaces?: { id: string; number: string },
): Promise<{ id: string; number: string; total: string; applied: string }> {
  const wanted = v.lines.filter((l) => l.quantity > 0);
  if (!wanted.length)
    throw new ValidationError({ lines: ["Enter a quantity to credit on at least one line"] });
  await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.salesDocument.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      lines: { orderBy: { position: "asc" } },
      derivedDocuments: { where: { kind: "CREDIT_NOTE", status: "POSTED" }, include: { lines: true } },
    },
  });
  if (!invoice || invoice.kind !== "INVOICE") throw new NotFoundError();
  if (invoice.status !== "POSTED") throw new ConflictError("Only a posted invoice can be credited.");
  const today = todayInNairobi();
  await assertBooksOpen(tx, today);

  const credited = new Map<string, number>();
  for (const cn of invoice.derivedDocuments) {
    for (const l of cn.lines) credited.set(lineKey(l), (credited.get(lineKey(l)) ?? 0) + l.quantity);
  }
  const errors: Record<string, string[]> = {};
  const lines = wanted.map((w, i) => {
    const orig = invoice.lines.find((l) => l.id === w.lineId);
    if (!orig) throw new ValidationError({ lines: ["A line isn't on this invoice. Reload the page."] });
    const remaining = orig.quantity - (credited.get(lineKey(orig)) ?? 0);
    if (w.quantity > remaining) {
      (errors[`lines.${invoice.lines.indexOf(orig)}.quantity`] ??= []).push(
        `Only ${remaining} left to credit on this line`,
      );
    }
    const t = calculateLine(
      {
        quantity: w.quantity,
        unitPrice: orig.unitPrice.toFixed(2),
        discountPercent: orig.discountPercent.toFixed(2),
        taxRate: orig.taxRate.toFixed(4),
      },
      invoice.pricesIncludeTax,
    );
    return {
      position: i + 1,
      productId: orig.productId,
      sku: orig.sku,
      description: orig.description,
      unit: orig.unit,
      quantity: w.quantity,
      piecesPerUnit: orig.piecesPerUnit,
      pieces: w.quantity * orig.piecesPerUnit,
      unitPrice: orig.unitPrice.toFixed(2),
      discountPercent: orig.discountPercent.toFixed(2),
      taxCategory: orig.taxCategory,
      taxRate: orig.taxRate.toFixed(4),
      netAmount: t.netAmount,
      discountAmount: t.discountAmount,
      taxAmount: t.taxAmount,
      grossAmount: t.grossAmount,
    };
  });
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const totals = sumLines(lines.map((l) => ({ ...l, listAmount: "0" })));
  const alreadyCredited = invoice.derivedDocuments.reduce((s, c) => s.plus(c.total), toDecimal(0));
  if (alreadyCredited.plus(totals.total).greaterThan(invoice.total)) {
    throw new ConflictError(
      `That would credit ${formatKES(alreadyCredited.plus(totals.total))} in total on a ${formatKES(invoice.total.toFixed(2))} invoice.`,
    );
  }

  const number = await nextNumber(tx, "CREDIT_NOTE");
  const cn = await tx.salesDocument.create({
    data: {
      kind: "CREDIT_NOTE",
      number,
      status: "DRAFT",
      customerId: invoice.customerId,
      warehouseId: invoice.warehouseId,
      pricesIncludeTax: invoice.pricesIncludeTax,
      issueDate: toDbDate(today),
      idempotencyKey: v.idempotencyKey,
      notes: v.reason,
      sourceDocumentId: invoice.id,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      total: totals.total,
      returnsToStock: v.returnsToStock,
      replacesId: replaces?.id,
      createdById: actor.id,
      lines: { create: lines },
    },
  });
  await tx.salesDocument.update({
    where: { id: cn.id },
    data: {
      status: "POSTED",
      postedAt: new Date(),
      postedById: actor.id,
      companySnapshot: (invoice.companySnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
      customerSnapshot: (invoice.customerSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  // Apply to the invoice's unpaid balance first.
  const outstanding = invoice.total.minus(invoice.amountPaid).minus(invoice.amountCredited);
  const applied = toDecimal(totals.total).lessThan(outstanding) ? toDecimal(totals.total) : outstanding;
  if (applied.greaterThan(0)) {
    await tx.paymentAllocation.create({
      data: {
        invoiceId: invoice.id,
        creditNoteId: cn.id,
        amount: applied.toFixed(2),
        createdById: actor.id,
      },
    });
    await tx.salesDocument.update({
      where: { id: invoice.id },
      data: { amountCredited: { increment: applied.toFixed(2) } },
    });
  }

  let returnedCost = toDecimal(0);
  if (v.returnsToStock) {
    // Goods come back at what they cost when they were sold on this invoice.
    const sold = await tx.stockMovement.groupBy({
      by: ["productId"],
      where: { sourceType: "Invoice", sourceId: invoice.id, type: "SALE" },
      _sum: { quantity: true, costValue: true },
      _count: { costValue: true, _all: true },
    });
    const perPiece = new Map(
      sold
        .filter((r) => r._count.costValue === r._count._all && r._sum.quantity)
        .map((r) => [
          r.productId,
          toDecimal(r._sum.costValue ?? 0).dividedBy(r._sum.quantity!), // both negative
        ]),
    );
    const stock = await applyStockChanges(
      tx,
      lines.map((l) => ({
        productId: l.productId,
        warehouseId: invoice.warehouseId,
        quantity: l.pieces,
        type: "RETURN_IN" as const,
        value: perPiece.has(l.productId)
          ? roundMoney(perPiece.get(l.productId)!.times(l.pieces)).toFixed(2)
          : undefined,
      })),
      {
        type: "CreditNote",
        id: cn.id,
        number,
        reason: `Returned on ${invoice.number}: ${v.reason}`,
        actorId: actor.id,
      },
    );
    returnedCost = stock.total;
  }

  await postJournal(tx, {
    date: today,
    description: `Credit note ${number} on ${invoice.number} — ${invoice.customer.name}: ${v.reason}`,
    sourceType: "CreditNote",
    sourceId: cn.id,
    sourceNumber: number,
    actorId: actor.id,
    lines: [
      { account: "SALES_RETURNS", debit: totals.subtotal },
      { account: "VAT_OUTPUT", debit: totals.taxTotal },
      { account: "AR", credit: totals.total, customerId: invoice.customerId },
      // Returned goods go back into stock and out of cost of sales.
      { account: "INVENTORY", debit: returnedCost.toFixed(2) },
      { account: "COGS", credit: returnedCost.toFixed(2) },
    ],
  });
  const leftover = toDecimal(totals.total).minus(applied);
  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "CREDIT_NOTE_POSTED",
    entityType: "SalesDocument",
    entityId: cn.id,
    summary:
      `${number} on ${invoice.number} (${invoice.customer.name}): ${formatKES(totals.total)}` +
      (replaces ? `, replacing ${replaces.number}` : "") +
      (leftover.greaterThan(0) ? `, ${formatKES(leftover)} kept as credit` : "") +
      (v.returnsToStock ? ", goods back in stock" : ""),
    after: {
      total: totals.total,
      reason: v.reason,
      returnsToStock: v.returnsToStock,
      ...(replaces ? { replaces: replaces.number } : {}),
    },
    ...ctx,
  });
  return { id: cn.id, number, total: totals.total, applied: applied.toFixed(2) };
}
