import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { piecesPerUnit } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { assertBooksOpen, postJournal } from "@/server/modules/accounting/journal";
import { applyStockChanges, isUniqueViolation } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { currentTaxRates } from "@/server/modules/sales/pricing";
import { parseInput } from "@/server/shared/validation";

import { goodsReceiptSchema } from "./schemas";
import type { z } from "zod";

export type ReceiptResult = {
  id: string;
  number: string;
  alreadyPosted: boolean;
  /** Products that were already in stock with no cost: their average is now understated until the opening cost is set. */
  uncosted?: string[];
};

/** The posting itself, inside the caller's transaction (also used by stock purchases). */
export async function receiveGoodsTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  v: z.output<typeof goodsReceiptSchema>,
  ctx: AuditContext = {},
) {
  const today = todayInNairobi();
  if (v.receivedOn > today) throw new ValidationError({ receivedOn: ["Can't be in the future"] });
  await assertBooksOpen(tx, v.receivedOn);
  const [supplier, warehouse] = await Promise.all([
    tx.supplier.findUnique({ where: { id: v.supplierId } }),
    tx.warehouse.findUnique({ where: { id: v.warehouseId } }),
  ]);
  if (!supplier) throw new ValidationError({ supplierId: ["Choose a supplier"] });
  if (!warehouse || warehouse.status !== "ACTIVE")
    throw new ValidationError({ warehouseId: ["Choose an active warehouse"] });

  const rates = await currentTaxRates(tx);
  const errors: Record<string, string[]> = {};
  type Line = {
    productId: string;
    orderLineId: string | null;
    unit: "PIECE" | "PACK" | "CARTON";
    quantity: number;
    pieces: number;
    unitCost: string;
    lineCost: string;
    taxRate: string;
    piecesPerUnit: number;
  };
  const lines: Line[] = [];

  // Purchase orders were removed (Nov 2026): goods always come in with their costs.
  if (v.purchaseOrderId) {
    throw new ValidationError({ purchaseOrderId: ["Purchase orders are no longer used"] });
  }
  const products = await tx.product.findMany({
    where: { id: { in: v.lines.map((l) => l.productId) } },
  });
  v.lines.forEach((l, i) => {
    if (l.quantity === 0) return;
    const p = products.find((x) => x.id === l.productId);
    if (!p) {
      errors[`lines.${i}.productId`] = ["Choose a product"];
      return;
    }
    if (l.unitCost === null) {
      errors[`lines.${i}.unitCost`] = ["Enter the cost per unit, excluding VAT"];
      return;
    }
    const ppu = piecesPerUnit(l.unit, p);
    lines.push({
      productId: p.id,
      orderLineId: null,
      unit: l.unit,
      quantity: l.quantity,
      pieces: l.quantity * ppu,
      piecesPerUnit: ppu,
      unitCost: l.unitCost,
      lineCost: roundMoney(toDecimal(l.unitCost).times(l.quantity)).toFixed(2),
      taxRate: rates.get(p.taxCategory) ?? "0",
    });
  });
  if (Object.keys(errors).length) throw new ValidationError(errors);
  if (!lines.length) throw new ValidationError({ lines: ["Enter what arrived on at least one line"] });

  const totalCost = lines.reduce((s, l) => s.plus(l.lineCost), toDecimal(0));
  const expectedTax = lines.reduce(
    (s, l) => s.plus(roundMoney(toDecimal(l.lineCost).times(l.taxRate).dividedBy(100))),
    toDecimal(0),
  );

  const number = await nextNumber(tx, "GOODS_RECEIPT");
  const grn = await tx.goodsReceipt.create({
    data: {
      number,
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      purchaseOrderId: null,
      receivedOn: toDbDate(v.receivedOn),
      supplierReference: v.supplierReference,
      notes: v.notes,
      totalCost: totalCost.toFixed(2),
      expectedTax: expectedTax.toFixed(2),
      idempotencyKey: v.idempotencyKey,
      postedById: actor.id,
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          orderLineId: l.orderLineId,
          unit: l.unit,
          quantity: l.quantity,
          pieces: l.pieces,
          unitCost: l.unitCost,
          lineCost: l.lineCost,
          taxRate: l.taxRate,
        })),
      },
    },
  });

  const uncosted = await tx.$queryRaw<{ name: string }[]>`
    SELECT p.name FROM products p JOIN inventory_valuations v ON v.product_id = p.id
     WHERE p.id = ANY(${[...new Set(lines.map((l) => l.productId))]}::uuid[]) AND v.value = 0
       AND (SELECT COALESCE(SUM(b.quantity), 0) FROM stock_balances b WHERE b.product_id = p.id) > 0
     ORDER BY p.name`;

  await applyStockChanges(
    tx,
    lines.map((l) => ({
      productId: l.productId,
      warehouseId: warehouse.id,
      quantity: l.pieces,
      type: "PURCHASE_IN" as const,
      value: l.lineCost,
    })),
    { type: "GoodsReceipt", id: grn.id, number, reason: `From ${supplier.name}`, actorId: actor.id },
  );

  // The latest cost per piece becomes the product's cost price (used as a default on new orders).
  for (const l of lines) {
    await tx.product.update({
      where: { id: l.productId },
      data: {
        costPrice: roundMoney(toDecimal(l.unitCost).dividedBy(l.piecesPerUnit)).toFixed(2),
        version: { increment: 1 },
      },
    });
  }

  if (totalCost.greaterThan(0)) {
    await postJournal(tx, {
      date: v.receivedOn,
      description: `Goods received ${number} from ${supplier.name}${v.supplierReference ? ` (${v.supplierReference})` : ""}`,
      sourceType: "GoodsReceipt",
      sourceId: grn.id,
      sourceNumber: number,
      actorId: actor.id,
      lines: [
        { account: "INVENTORY", debit: totalCost.toFixed(2) },
        { account: "GRNI", credit: totalCost.toFixed(2) },
      ],
    });
  }

  await writeAudit(tx, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "GOODS_RECEIVED",
    entityType: "GoodsReceipt",
    entityId: grn.id,
    summary: `${number} from ${supplier.name}: ${lines.length} line(s), ${formatKES(totalCost.toFixed(2))} at cost`,
    after: {
      lines: lines.map((l) => ({ productId: l.productId, pieces: l.pieces, cost: l.lineCost })),
    },
    ...ctx,
  });
  return { id: grn.id, number, alreadyPosted: false, uncosted: uncosted.map((u) => u.name) };
}

/**
 * Post goods received (GRN-). Puts the stock in at cost, updates the purchase
 * order, and posts Dr Inventory, Cr Goods received not yet billed.
 *
 * Against a purchase order, quantities are in the order's units and can't be
 * more than is still outstanding. Storekeepers (who don't see costs) can only
 * receive against an order; its costs are used. Without an order, costs are
 * entered here and need someone who can see costs.
 */
export async function postGoodsReceipt(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<ReceiptResult> {
  authorize(actor, "goods.receive");
  const v = parseInput(goodsReceiptSchema, input);
  const canCost = hasPermission(actor, "catalogue.costs");

  const existing = await db.goodsReceipt.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
  if (existing) return { id: existing.id, number: existing.number, alreadyPosted: true };
  if (!canCost) {
    throw new ForbiddenError(
      "Receive goods against a purchase order, or ask someone who can see costs to receive them.",
    );
  }

  try {
    return await db.$transaction((tx) => receiveGoodsTx(tx, actor, v, ctx), {
      maxWait: 15_000,
      timeout: 60_000,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.goodsReceipt.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number, alreadyPosted: true };
    }
    throw error;
  }
}

// ─── Reading ────────────────────────────────────────────────────────
