import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertBooksOpen, postJournal } from "@/server/modules/accounting/journal";
import { applyStockChanges, isUniqueViolation } from "@/server/modules/inventory/stock";
import { creditNoteSchema } from "@/server/modules/payments/schemas";
import type { AuditContext } from "@/server/modules/pricing/service";
import { isUuid, parseInput, requiredText, versionField } from "@/server/shared/validation";

import { issueCreditNote } from "./credit-notes";

/*
 * Owners and admins can correct or delete a credit note after it was issued.
 * An issued credit note itself never changes (the database refuses): instead
 * everything it did is undone, dated today, and it is kept, cancelled and
 * hidden, for the record. A correction then issues a new credit note (the next
 * CN- number) with the right figures, linked to the one it replaces.
 */

const why = requiredText(500, "Say why it's being changed");

export const deleteCreditNoteSchema = z.object({ version: versionField, why });
export const correctCreditNoteSchema = creditNoteSchema.extend({ version: versionField, why });

type Tx = Prisma.TransactionClient;

async function lock(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${id}::uuid FOR UPDATE`;
}

async function loadForChange(tx: Tx, id: string, version: number) {
  if (!isUuid(id)) throw new NotFoundError();
  await lock(tx, id);
  const cn = await tx.salesDocument.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      lines: { orderBy: { position: "asc" } },
      allocationsGiven: { where: { reversedAt: null }, orderBy: { createdAt: "asc" } },
      sourceDocument: { select: { id: true, number: true } },
    },
  });
  if (!cn || cn.kind !== "CREDIT_NOTE") throw new NotFoundError();
  if (cn.deletedAt) throw new ConflictError(`${cn.number} was already changed or deleted.`);
  if (cn.status !== "POSTED") throw new ConflictError(`${cn.number} isn't issued.`);
  if (cn.version !== version) {
    throw new ConflictError(`${cn.number} was changed by someone else. Reload the page and try again.`);
  }
  return cn;
}
type LoadedCreditNote = Awaited<ReturnType<typeof loadForChange>>;

/**
 * Undo everything a credit note did, inside the caller's transaction:
 *  - the credit it gave stops counting: the invoices it reduced owe that again;
 *  - goods it put back into stock go out again (at today's average cost);
 *  - its ledger entry is reversed;
 *  - it's marked cancelled and deleted, and frozen from then on.
 * Returns where its credit had been applied, so a correction can re-apply it.
 */
async function undoCreditNote(tx: Tx, actor: Actor, cn: LoadedCreditNote, reason: string) {
  const today = todayInNairobi();
  await assertBooksOpen(tx, today);
  const now = new Date();

  // 1. Its credit comes off every invoice it was applied to.
  for (const a of cn.allocationsGiven) {
    await lock(tx, a.invoiceId);
    await tx.paymentAllocation.update({ where: { id: a.id }, data: { reversedAt: now } });
    await tx.salesDocument.update({
      where: { id: a.invoiceId },
      data: { amountCredited: { decrement: a.amount.toFixed(2) } },
    });
  }

  // 2. Returned goods go out again.
  let stockCost = toDecimal(0);
  if (cn.returnsToStock) {
    const returned = await tx.stockMovement.groupBy({
      by: ["productId", "warehouseId"],
      where: { sourceType: "CreditNote", sourceId: cn.id, type: "RETURN_IN" },
      _sum: { quantity: true },
    });
    try {
      const out = await applyStockChanges(
        tx,
        returned.map((r) => ({
          productId: r.productId,
          warehouseId: r.warehouseId,
          quantity: -(r._sum.quantity ?? 0),
          type: "ADJUSTMENT_OUT" as const,
        })),
        {
          type: "CreditNoteDeletion",
          id: cn.id,
          number: cn.number!,
          reason: `${cn.number} undone: ${reason}`,
          actorId: actor.id,
        },
      );
      stockCost = out.total.abs();
    } catch (e) {
      if (e instanceof ConflictError && e.message.startsWith("Not enough stock")) {
        throw new ConflictError(
          `The goods ${cn.number} put back into stock have gone out again since, so it can't be undone ` +
            `with them coming out of stock. ${e.message}`,
        );
      }
      throw e;
    }
  }

  // 3. The ledger: its own entry mirrored; returned goods leave stock at what they're worth today.
  const entries = await tx.journalEntry.findMany({
    where: { sourceType: "CreditNote", sourceId: cn.id },
    include: { lines: { include: { account: { select: { systemKey: true } } } } },
  });
  const lines = entries
    .flatMap((e) => e.lines)
    .filter((l) => l.account.systemKey !== "INVENTORY" && l.account.systemKey !== "COGS")
    .map((l) => ({
      account: { id: l.accountId },
      debit: l.credit.toFixed(2),
      credit: l.debit.toFixed(2),
      customerId: l.customerId,
      description: l.description,
    }));
  await postJournal(tx, {
    date: today,
    description: `Credit note ${cn.number} undone (${cn.customer.name}): ${reason}`,
    sourceType: "CreditNoteDeletion",
    sourceId: cn.id,
    sourceNumber: cn.number!,
    actorId: actor.id,
    lines: [
      ...lines,
      { account: "COGS", debit: stockCost.toFixed(2) },
      { account: "INVENTORY", credit: stockCost.toFixed(2) },
    ],
  });

  // 4. Kept for the record, frozen.
  await tx.salesDocument.update({
    where: { id: cn.id },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelReason: reason,
      deletedAt: now,
      deletedById: actor.id,
      version: { increment: 1 },
    },
  });

  return {
    snapshot: {
      number: cn.number,
      invoice: cn.sourceDocument?.number,
      total: cn.total.toFixed(2),
      reason: cn.notes,
      returnsToStock: cn.returnsToStock,
      lines: cn.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unit: l.unit })),
    },
    /** Where its credit had gone, apart from its own invoice, in the order it was applied. */
    elsewhere: cn.allocationsGiven
      .filter((a) => a.invoiceId !== cn.sourceDocumentId)
      .map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
  };
}

/** Delete an issued credit note (owners and admins): undone in full, then hidden. */
export async function deleteCreditNote(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<{ number: string; total: string }> {
  authorize(actor, "credit_notes.edit");
  const v = parseInput(deleteCreditNoteSchema, input);
  return db.$transaction(async (tx) => {
    const cn = await loadForChange(tx, id, v.version);
    const undone = await undoCreditNote(tx, actor, cn, `Deleted: ${v.why}`);
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "CREDIT_NOTE_DELETED",
      entityType: "SalesDocument",
      entityId: cn.id,
      summary:
        `${cn.number} on ${cn.sourceDocument?.number} (${cn.customer.name}, ${formatKES(cn.total.toFixed(2))}) ` +
        `deleted: ${v.why}` +
        (cn.returnsToStock ? "; returned goods taken back out of stock" : ""),
      before: undone.snapshot,
      ...ctx,
    });
    return { number: cn.number!, total: cn.total.toFixed(2) };
  });
}

/**
 * Correct an issued credit note (owners and admins): the old one is undone and
 * a new one issued with the right lines, reason and stock choice. Credit the
 * old one had applied to other invoices is applied to them again, as far as
 * the new one's credit goes. Sending the same form twice corrects once.
 */
export async function correctCreditNote(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<{ id: string; number: string; replaced: string; alreadyDone: boolean }> {
  authorize(actor, "credit_notes.edit");
  const v = parseInput(correctCreditNoteSchema, input);
  if (!v.lines.some((l) => l.quantity > 0)) {
    throw new ValidationError({
      lines: ["Enter a quantity to credit on at least one line (to cancel it altogether, delete it instead)"],
    });
  }
  const done = async () => {
    const existing = await db.salesDocument.findUnique({
      where: { idempotencyKey: v.idempotencyKey },
      include: { replaces: { select: { number: true } } },
    });
    return existing
      ? {
          id: existing.id,
          number: existing.number!,
          replaced: existing.replaces?.number ?? "",
          alreadyDone: true,
        }
      : null;
  };
  const earlier = await done();
  if (earlier) return earlier;

  try {
    return await db.$transaction(async (tx) => {
      const old = await loadForChange(tx, id, v.version);
      const before = new Map(old.lines.map((l) => [`${l.productId}|${l.unit}`, l.quantity]));
      const invoiceLines = await tx.salesDocumentLine.findMany({
        where: { documentId: old.sourceDocumentId! },
      });
      const after = new Map(
        v.lines
          .filter((l) => l.quantity > 0)
          .map((l) => {
            const il = invoiceLines.find((x) => x.id === l.lineId);
            return [il ? `${il.productId}|${il.unit}` : l.lineId, l.quantity] as const;
          }),
      );
      const sameLines = before.size === after.size && [...before].every(([k, q]) => after.get(k) === q);
      if (sameLines && v.reason === (old.notes ?? "") && v.returnsToStock === old.returnsToStock) {
        throw new ValidationError({ form: ["Nothing was changed."] });
      }

      const undone = await undoCreditNote(tx, actor, old, `Corrected: ${v.why}`);
      const issued = await issueCreditNote(tx, actor, old.sourceDocumentId!, v, ctx, {
        id: old.id,
        number: old.number!,
      });

      // Re-apply credit the old one had given to other invoices, as far as the new one's credit goes.
      let left = toDecimal(issued.total).minus(issued.applied);
      const reapplied: string[] = [];
      for (const e of undone.elsewhere) {
        if (left.lessThanOrEqualTo(0)) break;
        await lock(tx, e.invoiceId);
        const inv = await tx.salesDocument.findUnique({ where: { id: e.invoiceId } });
        if (!inv || inv.status !== "POSTED" || inv.deletedAt) continue;
        const outstanding = inv.total.minus(inv.amountPaid).minus(inv.amountCredited);
        const amount = [e.amount, left, outstanding].reduce((m, x) => (x.lessThan(m) ? x : m));
        if (amount.lessThanOrEqualTo(0)) continue;
        await tx.paymentAllocation.create({
          data: {
            invoiceId: inv.id,
            creditNoteId: issued.id,
            amount: amount.toFixed(2),
            createdById: actor.id,
          },
        });
        await tx.salesDocument.update({
          where: { id: inv.id },
          data: { amountCredited: { increment: amount.toFixed(2) } },
        });
        left = left.minus(amount);
        reapplied.push(`${inv.number} ${formatKES(amount.toFixed(2))}`);
      }

      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "CREDIT_NOTE_CORRECTED",
        entityType: "SalesDocument",
        entityId: old.id,
        summary:
          `${old.number} (${formatKES(old.total.toFixed(2))}) replaced by ${issued.number} ` +
          `(${formatKES(issued.total)}) on ${old.sourceDocument?.number}: ${v.why}` +
          (reapplied.length ? `; credit re-applied to ${reapplied.join(", ")}` : ""),
        before: undone.snapshot,
        after: {
          number: issued.number,
          total: issued.total,
          reason: v.reason,
          returnsToStock: v.returnsToStock,
        },
        ...ctx,
      });
      return { id: issued.id, number: issued.number, replaced: old.number!, alreadyDone: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await done();
      if (winner) return winner;
    }
    throw error;
  }
}

/** What the correction form needs: the invoice's lines with what can be credited if this one is replaced. */
export async function correctionForm(db: Db, actor: Actor, id: string) {
  authorize(actor, "credit_notes.edit");
  if (!isUuid(id)) throw new NotFoundError();
  const cn = await db.salesDocument.findUnique({
    where: { id },
    include: {
      lines: true,
      allocationsGiven: { where: { reversedAt: null } },
      sourceDocument: {
        include: {
          customer: { select: { name: true } },
          lines: { orderBy: { position: "asc" } },
          derivedDocuments: {
            where: { kind: "CREDIT_NOTE", status: "POSTED" },
            include: { lines: true },
          },
        },
      },
    },
  });
  if (!cn || cn.kind !== "CREDIT_NOTE" || !cn.sourceDocument) throw new NotFoundError();
  const invoice = cn.sourceDocument;
  const key = (l: { productId: string; unit: string }) => `${l.productId}|${l.unit}`;
  // Credited by the other credit notes on this invoice (this one's quantities are free again).
  const others = new Map<string, number>();
  for (const o of invoice.derivedDocuments) {
    if (o.id === cn.id) continue;
    for (const l of o.lines) others.set(key(l), (others.get(key(l)) ?? 0) + l.quantity);
  }
  const mine = new Map(cn.lines.map((l) => [key(l), l.quantity]));
  const appliedHere = cn.allocationsGiven
    .filter((a) => a.invoiceId === invoice.id)
    .reduce((s, a) => s.plus(a.amount), toDecimal(0));
  return {
    creditNote: {
      id: cn.id,
      number: cn.number!,
      version: cn.version,
      status: cn.status,
      deleted: !!cn.deletedAt,
      reason: cn.notes ?? "",
      returnsToStock: cn.returnsToStock,
      total: cn.total.toFixed(2),
    },
    invoice: {
      id: invoice.id,
      number: invoice.number!,
      customer: invoice.customer.name,
      pricesIncludeTax: invoice.pricesIncludeTax,
      total: invoice.total.toFixed(2),
      /** Still owed on the invoice if this credit note's part were taken off. */
      outstanding: invoice.total
        .minus(invoice.amountPaid)
        .minus(invoice.amountCredited)
        .plus(appliedHere)
        .toFixed(2),
    },
    lines: invoice.lines.map((l) => ({
      id: l.id,
      sku: l.sku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toFixed(2),
      discountPercent: l.discountPercent.toFixed(2),
      taxRate: l.taxRate.toFixed(4),
      remaining: l.quantity - Math.min(l.quantity, others.get(key(l)) ?? 0),
      current: mine.get(key(l)) ?? 0,
    })),
  };
}
