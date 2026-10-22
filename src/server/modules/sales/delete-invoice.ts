import "server-only";

import { z } from "zod";

import { todayInNairobi } from "@/lib/dates";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { ConflictError, NotFoundError } from "@/server/errors";
import { assertBooksOpen, postJournal } from "@/server/modules/accounting/journal";
import { applyStockChanges } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput, versionField } from "@/server/shared/validation";

export const deleteInvoiceSchema = z.object({
  version: versionField,
  reason: z.string().trim().min(3, "Say why it's being deleted").max(500),
  /** For a posted invoice: did the goods come back (or never leave)? */
  returnsToStock: z
    .unknown()
    .optional()
    .transform((v) => v === undefined || v === true || v === "on" || v === "true"),
});

export type DeleteInvoiceResult = {
  number: string | null;
  /** Money from payments that was on this invoice and is now credit on the customer's account. */
  creditFreed: string;
  stockReturned: boolean;
};

async function lock(tx: DbOrTx, id: string) {
  await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${id}::uuid FOR UPDATE`;
}

/**
 * Delete an invoice (owners and admins). Everything it did is undone in one
 * transaction, dated today:
 *  - stock comes back at what it cost when sold (unless the goods aren't coming back);
 *  - its ledger entry is reversed (sales, VAT, receivables, and cost of goods
 *    sold when the stock returns); an old-system invoice's opening balance is reversed;
 *  - payments and credit applied to it are released, as credit on the customer's account;
 *  - its delivery note, share links and the sales order it came from are cancelled.
 * The invoice is then hidden everywhere (status cancelled + deleted), keeping its
 * number and lines for the record; the database freezes it from then on.
 * Refused while credit notes exist for it, or in a closed period.
 */
export async function deleteInvoice(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
): Promise<DeleteInvoiceResult> {
  authorize(actor, "invoices.delete");
  const v = parseInput(deleteInvoiceSchema, input);
  return db.$transaction(async (tx) => {
    await lock(tx, id);
    const doc = await tx.salesDocument.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true } },
        lines: { orderBy: { position: "asc" } },
        allocationsReceived: { where: { reversedAt: null } },
        derivedDocuments: { where: { kind: "CREDIT_NOTE", status: "POSTED" }, select: { number: true } },
        deliveryNote: true,
        sourceDocument: { select: { id: true, kind: true, status: true, number: true } },
      },
    });
    if (!doc || doc.kind !== "INVOICE") throw new NotFoundError();
    if (doc.deletedAt) throw new ConflictError("This invoice was already deleted.");
    if (doc.version !== v.version) {
      throw new ConflictError("This invoice was changed by someone else. Reload the page and try again.");
    }
    const label = doc.number ?? "Draft invoice";
    const now = new Date();
    const today = todayInNairobi();
    const reason = `Deleted: ${v.reason}`;
    const snapshot = {
      number: doc.number,
      status: doc.status,
      customer: doc.customer.name,
      issueDate: doc.issueDate.toISOString().slice(0, 10),
      total: doc.total.toFixed(2),
      taxTotal: doc.taxTotal.toFixed(2),
      historical: doc.historical,
      lines: doc.lines.map((l) => ({
        sku: l.sku,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice.toFixed(2),
        gross: l.grossAmount.toFixed(2),
      })),
    };

    let creditFreed = toDecimal(0);
    let stockReturned = false;

    if (doc.status === "POSTED") {
      if (doc.derivedDocuments.length) {
        throw new ConflictError(
          `${label} has credit note ${doc.derivedDocuments.map((c) => c.number).join(", ")}. ` +
            "An invoice with credit notes can't be deleted; credit the rest instead.",
        );
      }
      await assertBooksOpen(tx, today);

      // 1. Release payments and credit applied to it.
      for (const a of doc.allocationsReceived) {
        await tx.paymentAllocation.update({ where: { id: a.id }, data: { reversedAt: now } });
        if (a.paymentId) creditFreed = creditFreed.plus(a.amount);
        if (a.creditNoteId) {
          await lock(tx, a.creditNoteId);
          creditFreed = creditFreed.plus(a.amount);
        }
      }

      // 2. Stock back, at what it cost when sold.
      if (!doc.historical && v.returnsToStock) {
        const sold = await tx.stockMovement.groupBy({
          by: ["productId", "warehouseId"],
          where: { sourceType: "Invoice", sourceId: doc.id, type: "SALE" },
          _sum: { quantity: true, costValue: true },
          _count: { costValue: true, _all: true },
        });
        await applyStockChanges(
          tx,
          sold.map((r) => ({
            productId: r.productId,
            warehouseId: r.warehouseId,
            quantity: -(r._sum.quantity ?? 0),
            type: "RETURN_IN" as const,
            value:
              r._count.costValue === r._count._all && r._sum.costValue
                ? roundMoney(toDecimal(r._sum.costValue).negated()).toFixed(2)
                : undefined,
          })),
          { type: "InvoiceDeletion", id: doc.id, number: doc.number!, reason, actorId: actor.id },
        );
        stockReturned = sold.length > 0;
      }

      // 3. The ledger: the invoice's own entry mirrored (old-system invoices: their opening balance).
      if (doc.historical) {
        const opening = await tx.journalEntry.findFirst({ where: { sourceType: "OpeningBalances" } });
        const paidHere = doc.allocationsReceived
          .filter((a) => a.paymentId)
          .reduce((s, a) => s.plus(a.amount), toDecimal(0));
        const owedAtImport = doc.total.minus(doc.amountPaid.minus(paidHere));
        if (opening && owedAtImport.greaterThan(0)) {
          await postJournal(tx, {
            date: today,
            description: `Old-system invoice ${doc.number} deleted (${doc.customer.name}): ${v.reason}`,
            sourceType: "InvoiceDeletion",
            sourceId: doc.id,
            sourceNumber: doc.number!,
            actorId: actor.id,
            lines: [
              { account: "OPENING", debit: owedAtImport.toFixed(2) },
              { account: "AR", credit: owedAtImport.toFixed(2), customerId: doc.customerId },
            ],
          });
        }
      } else {
        const entries = await tx.journalEntry.findMany({
          where: { sourceType: "Invoice", sourceId: doc.id },
          include: { lines: { include: { account: { select: { systemKey: true } } } } },
        });
        // Goods not coming back stay sold: cost of goods sold is left as it was.
        const keep = (key: string | null) => v.returnsToStock || (key !== "COGS" && key !== "INVENTORY");
        const lines = entries
          .flatMap((e) => e.lines)
          .filter((l) => keep(l.account.systemKey))
          .map((l) => ({
            account: { id: l.accountId },
            debit: l.credit.toFixed(2),
            credit: l.debit.toFixed(2),
            customerId: l.customerId,
            description: l.description,
          }));
        if (lines.length) {
          await postJournal(tx, {
            date: today,
            description: `Invoice ${doc.number} deleted (${doc.customer.name}): ${v.reason}`,
            sourceType: "InvoiceDeletion",
            sourceId: doc.id,
            sourceNumber: doc.number!,
            actorId: actor.id,
            lines,
          });
        }
      }

      // 4. What hangs off it.
      if (doc.deliveryNote && !["DELIVERED", "CANCELLED"].includes(doc.deliveryNote.status)) {
        await tx.deliveryNote.update({
          where: { id: doc.deliveryNote.id },
          data: {
            status: "CANCELLED",
            notes: [doc.deliveryNote.notes, `Cancelled: invoice ${doc.number} deleted`]
              .filter(Boolean)
              .join("\n"),
            version: { increment: 1 },
          },
        });
      }
      await tx.documentShareLink.updateMany({
        where: { documentId: doc.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (doc.sourceDocument?.kind === "SALES_ORDER" && doc.sourceDocument.status === "INVOICED") {
        await tx.salesDocument.update({
          where: { id: doc.sourceDocument.id },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            cancelReason: `Its invoice ${doc.number} was deleted`,
            version: { increment: 1 },
          },
        });
      }
    } else if (doc.status !== "DRAFT" && doc.status !== "CANCELLED") {
      throw new ConflictError(`${label} is ${doc.status.toLowerCase()} and can't be deleted.`);
    }

    await tx.salesDocument.update({
      where: { id: doc.id },
      data: {
        status: "CANCELLED",
        cancelledAt: doc.cancelledAt ?? now,
        cancelReason: doc.status === "CANCELLED" ? doc.cancelReason : reason,
        deletedAt: now,
        deletedById: actor.id,
        amountPaid: 0,
        amountCredited: 0,
        version: { increment: 1 },
      },
    });

    // Credit-note allocations freed above: the credit note's own balance goes back up (it's derived).
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "INVOICE_DELETED",
      entityType: "SalesDocument",
      entityId: doc.id,
      summary:
        `${label} for ${doc.customer.name} (${formatKES(doc.total.toFixed(2))}) deleted: ${v.reason}` +
        (creditFreed.greaterThan(0)
          ? `; ${formatKES(creditFreed.toFixed(2))} paid on it is now credit`
          : "") +
        (doc.status === "POSTED" && !doc.historical
          ? stockReturned
            ? "; stock returned"
            : "; goods not returned to stock"
          : ""),
      before: snapshot,
      ...ctx,
    });
    return { number: doc.number, creditFreed: creditFreed.toFixed(2), stockReturned };
  });
}
