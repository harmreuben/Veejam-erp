import "server-only";

import { toPieces } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, ValidationError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { todayInNairobi } from "@/lib/dates";
import { postStockValue } from "@/server/modules/accounting/journal";
import { parseInput } from "@/server/shared/validation";

import { ADJUSTMENT_REASON_LABELS, adjustmentSchema, transferSchema } from "./schemas";
import { applyStockChanges, isUniqueViolation } from "./stock";

async function activeWarehouse(tx: DbOrTx, id: string, field: string) {
  const w = await tx.warehouse.findUnique({ where: { id } });
  if (!w || w.status !== "ACTIVE") throw new ValidationError({ [field]: ["Choose an active warehouse"] });
  return w;
}

async function productsFor(tx: DbOrTx, ids: string[]) {
  const products = await tx.product.findMany({ where: { id: { in: ids } } });
  if (products.length !== new Set(ids).size)
    throw new ConflictError("Some products no longer exist. Reload the page.");
  return new Map(products.map((p) => [p.id, p]));
}

export type PostResult = { id: string; number: string; alreadyPosted: boolean };

/**
 * Post a stock adjustment (gain or write-off). Posted immediately; corrections
 * are made with another adjustment, never by editing this one.
 * Sending the same idempotency key twice returns the first result.
 */
export async function postAdjustment(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<PostResult> {
  authorize(actor, "inventory.adjust");
  const values = parseInput(adjustmentSchema, input);

  const existing = await db.stockAdjustment.findUnique({ where: { idempotencyKey: values.idempotencyKey } });
  if (existing) return { id: existing.id, number: existing.number, alreadyPosted: true };

  try {
    return await db.$transaction(async (tx) => {
      const warehouse = await activeWarehouse(tx, values.warehouseId, "warehouseId");
      const products = await productsFor(
        tx,
        values.lines.map((l) => l.productId),
      );
      const lines = values.lines.map((l, i) => {
        const p = products.get(l.productId)!;
        if (l.direction === "IN" && p.status !== "ACTIVE") {
          throw new ValidationError({
            [`lines.${i}.productId`]: [`${p.name} is inactive; reactivate it to add stock`],
          });
        }
        const pieces = toPieces(l.quantity, l.unit, p);
        return { ...l, pieces: l.direction === "IN" ? pieces : -pieces };
      });

      const number = await nextNumber(tx, "STOCK_ADJUSTMENT");
      const adj = await tx.stockAdjustment.create({
        data: {
          number,
          warehouseId: warehouse.id,
          reason: values.reason,
          notes: values.notes,
          idempotencyKey: values.idempotencyKey,
          postedById: actor.id,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              unit: l.unit,
              unitQuantity: l.direction === "IN" ? l.quantity : -l.quantity,
              quantity: l.pieces,
            })),
          },
        },
      });
      const stock = await applyStockChanges(
        tx,
        lines.map((l) => ({
          productId: l.productId,
          warehouseId: warehouse.id,
          quantity: l.pieces,
          type: l.pieces > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
        })),
        {
          type: "StockAdjustment",
          id: adj.id,
          number,
          reason: `${ADJUSTMENT_REASON_LABELS[values.reason]}${values.notes ? `: ${values.notes}` : ""}`,
          actorId: actor.id,
        },
      );
      // Opening stock is part of the opening balances; anything else is a stock gain or loss.
      await postStockValue(tx, {
        change: stock.total,
        against: values.reason === "OPENING_BALANCE" ? "OPENING" : "STOCK_ADJ",
        date: todayInNairobi(),
        description: `Stock adjustment ${number}: ${ADJUSTMENT_REASON_LABELS[values.reason]}`,
        sourceType: "StockAdjustment",
        sourceId: adj.id,
        sourceNumber: number,
        actorId: actor.id,
      });
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "STOCK_ADJUSTED",
        entityType: "StockAdjustment",
        entityId: adj.id,
        summary: `${number} ${warehouse.name}: ${ADJUSTMENT_REASON_LABELS[values.reason]}, ${lines.length} line(s)`,
        after: {
          reason: values.reason,
          lines: lines.map((l) => ({ productId: l.productId, pieces: l.pieces })),
        },
        ...ctx,
      });
      return { id: adj.id, number, alreadyPosted: false };
    });
  } catch (error) {
    // Two submissions of the same form raced; the other one won. Return its result.
    if (isUniqueViolation(error)) {
      const winner = await db.stockAdjustment.findUnique({
        where: { idempotencyKey: values.idempotencyKey },
      });
      if (winner) return { id: winner.id, number: winner.number, alreadyPosted: true };
    }
    throw error;
  }
}

/** Move stock between two warehouses in one step. */
export async function postTransfer(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<PostResult> {
  authorize(actor, "inventory.transfer");
  const values = parseInput(transferSchema, input);

  const existing = await db.stockTransfer.findUnique({ where: { idempotencyKey: values.idempotencyKey } });
  if (existing) return { id: existing.id, number: existing.number, alreadyPosted: true };

  try {
    return await db.$transaction(async (tx) => {
      const from = await activeWarehouse(tx, values.fromWarehouseId, "fromWarehouseId");
      const to = await activeWarehouse(tx, values.toWarehouseId, "toWarehouseId");
      const products = await productsFor(
        tx,
        values.lines.map((l) => l.productId),
      );
      const lines = values.lines.map((l) => ({
        ...l,
        pieces: toPieces(l.quantity, l.unit, products.get(l.productId)!),
      }));

      const number = await nextNumber(tx, "STOCK_TRANSFER");
      const transfer = await tx.stockTransfer.create({
        data: {
          number,
          fromWarehouseId: from.id,
          toWarehouseId: to.id,
          notes: values.notes,
          idempotencyKey: values.idempotencyKey,
          postedById: actor.id,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              unit: l.unit,
              unitQuantity: l.quantity,
              quantity: l.pieces,
            })),
          },
        },
      });
      await applyStockChanges(
        tx,
        lines.flatMap((l) => [
          {
            productId: l.productId,
            warehouseId: from.id,
            quantity: -l.pieces,
            type: "TRANSFER_OUT" as const,
          },
          { productId: l.productId, warehouseId: to.id, quantity: l.pieces, type: "TRANSFER_IN" as const },
        ]),
        { type: "StockTransfer", id: transfer.id, number, reason: values.notes, actorId: actor.id },
        { respectReservations: true },
      );
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "STOCK_TRANSFERRED",
        entityType: "StockTransfer",
        entityId: transfer.id,
        summary: `${number} ${from.name} → ${to.name}, ${lines.length} line(s)`,
        after: { lines: lines.map((l) => ({ productId: l.productId, pieces: l.pieces })) },
        ...ctx,
      });
      return { id: transfer.id, number, alreadyPosted: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.stockTransfer.findUnique({ where: { idempotencyKey: values.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number, alreadyPosted: true };
    }
    throw error;
  }
}
