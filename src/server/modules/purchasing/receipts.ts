import "server-only";

import type { Prisma, PurchaseOrder, PurchaseOrderLine } from "@/generated/prisma/client";
import { fromDbDate, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { formatQuantity, piecesPerUnit } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { assertBooksOpen, postJournal } from "@/server/modules/accounting/journal";
import { applyStockChanges, isUniqueViolation } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { currentTaxRates } from "@/server/modules/sales/pricing";
import { isUuid, parseInput } from "@/server/shared/validation";

import { OPEN_PO_STATUSES } from "./orders";
import { goodsReceiptSchema } from "./schemas";

export type ReceiptResult = {
  id: string;
  number: string;
  alreadyPosted: boolean;
  /** Products that were already in stock with no cost: their average is now understated until the opening cost is set. */
  uncosted?: string[];
};

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
  if (!v.purchaseOrderId && !canCost) {
    throw new ForbiddenError(
      "Receive goods against a purchase order, or ask someone who can see costs to receive them.",
    );
  }

  try {
    return await db.$transaction(
      async (tx) => {
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

        let po: (PurchaseOrder & { lines: PurchaseOrderLine[] }) | null = null;
        if (v.purchaseOrderId) {
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM purchase_orders WHERE id = ${v.purchaseOrderId}::uuid FOR UPDATE`;
          if (!locked.length)
            throw new ValidationError({ purchaseOrderId: ["That purchase order no longer exists"] });
          po = await tx.purchaseOrder.findUniqueOrThrow({
            where: { id: v.purchaseOrderId },
            include: { lines: true },
          });
          if (!OPEN_PO_STATUSES.includes(po.status)) {
            throw new ConflictError(
              po.status === "DRAFT"
                ? `${po.number} hasn't been sent to the supplier yet. Mark it as ordered first.`
                : `${po.number} isn't expecting any more goods.`,
            );
          }
          if (po.supplierId !== supplier.id)
            throw new ValidationError({ supplierId: [`${po.number} is for a different supplier`] });
          v.lines.forEach((l, i) => {
            if (l.quantity === 0) return;
            const ol = po!.lines.find((x) => x.id === l.orderLineId);
            if (!ol) {
              errors[`lines.${i}.quantity`] = ["This line isn't on the purchase order. Reload the page."];
              return;
            }
            const pieces = l.quantity * ol.piecesPerUnit;
            const left = ol.pieces - ol.receivedPieces;
            if (pieces > left) {
              errors[`lines.${i}.quantity`] = [
                `Only ${left / ol.piecesPerUnit} ${ol.unit.toLowerCase()}(s) still to come on this order`,
              ];
              return;
            }
            const unitCost = canCost && l.unitCost !== null ? l.unitCost : ol.unitCost.toFixed(2);
            lines.push({
              productId: ol.productId,
              orderLineId: ol.id,
              unit: ol.unit,
              quantity: l.quantity,
              pieces,
              piecesPerUnit: ol.piecesPerUnit,
              unitCost,
              lineCost: roundMoney(toDecimal(unitCost).times(l.quantity)).toFixed(2),
              taxRate: ol.taxRate.toFixed(4),
            });
          });
        } else {
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
        }
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
            purchaseOrderId: po?.id ?? null,
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

        if (po) {
          for (const l of lines) {
            await tx.purchaseOrderLine.update({
              where: { id: l.orderLineId! },
              data: { receivedPieces: { increment: l.pieces } },
            });
          }
          const after = await tx.purchaseOrderLine.findMany({ where: { orderId: po.id } });
          const complete = after.every((l) => l.receivedPieces >= l.pieces);
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { status: complete ? "RECEIVED" : "PARTLY_RECEIVED", version: { increment: 1 } },
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
          summary: `${number} from ${supplier.name}${po ? ` on ${po.number}` : ""}: ${lines.length} line(s), ${formatKES(totalCost.toFixed(2))} at cost`,
          after: {
            lines: lines.map((l) => ({ productId: l.productId, pieces: l.pieces, cost: l.lineCost })),
          },
          ...ctx,
        });
        return { id: grn.id, number, alreadyPosted: false, uncosted: uncosted.map((u) => u.name) };
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await db.goodsReceipt.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number, alreadyPosted: true };
    }
    throw error;
  }
}

// ─── Reading ────────────────────────────────────────────────────────

export async function listGoodsReceipts(
  db: Db,
  actor: Actor,
  filter: { q?: string; unbilled?: boolean; supplierId?: string } = {},
) {
  authorize(actor, "purchasing.view");
  const showCosts = hasPermission(actor, "catalogue.costs");
  const where: Prisma.GoodsReceiptWhereInput = {};
  if (filter.unbilled) where.billId = null;
  if (filter.supplierId && isUuid(filter.supplierId)) where.supplierId = filter.supplierId;
  if (filter.q) {
    where.OR = [
      { number: { contains: filter.q, mode: "insensitive" } },
      { supplierReference: { contains: filter.q, mode: "insensitive" } },
      { supplier: { name: { contains: filter.q, mode: "insensitive" } } },
    ];
  }
  const rows = await db.goodsReceipt.findMany({
    where,
    include: {
      supplier: { select: { name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      bill: { select: { id: true, number: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: [{ receivedOn: "desc" }, { number: "desc" }],
    take: 200,
  });
  return {
    showCosts,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      supplier: r.supplier.name,
      warehouse: r.warehouse.name,
      receivedOn: fromDbDate(r.receivedOn),
      supplierReference: r.supplierReference,
      purchaseOrder: r.purchaseOrder,
      bill: r.bill,
      totalCost: showCosts ? r.totalCost.toFixed(2) : null,
    })),
  };
}

export async function getGoodsReceipt(db: Db, actor: Actor, id: string) {
  authorize(actor, "purchasing.view");
  if (!isUuid(id)) throw new NotFoundError();
  const showCosts = hasPermission(actor, "catalogue.costs");
  const r = await db.goodsReceipt.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      warehouse: { select: { name: true } },
      purchaseOrder: { select: { id: true, number: true } },
      bill: { select: { id: true, number: true, supplierInvoiceNumber: true } },
      postedBy: { select: { fullName: true } },
      lines: {
        include: { product: { select: { sku: true, name: true, unitsPerPack: true, packsPerCarton: true } } },
      },
    },
  });
  if (!r) throw new NotFoundError();
  return {
    showCosts,
    id: r.id,
    number: r.number,
    supplier: r.supplier,
    warehouse: r.warehouse.name,
    purchaseOrder: r.purchaseOrder,
    bill: r.bill,
    receivedOn: fromDbDate(r.receivedOn),
    supplierReference: r.supplierReference,
    notes: r.notes,
    postedBy: r.postedBy.fullName,
    postedAt: r.postedAt,
    totalCost: showCosts ? r.totalCost.toFixed(2) : null,
    expectedTax: showCosts ? r.expectedTax.toFixed(2) : null,
    lines: r.lines.map((l) => ({
      id: l.id,
      sku: l.product.sku,
      name: l.product.name,
      unit: l.unit,
      quantity: l.quantity,
      pieces: l.pieces,
      quantityText: formatQuantity(l.pieces, l.product),
      unitCost: showCosts ? l.unitCost.toFixed(2) : null,
      lineCost: showCosts ? l.lineCost.toFixed(2) : null,
    })),
  };
}

/** What the "receive goods" form needs: open orders (with what's still to come) or products for a direct receipt. */
export async function receiptFormData(db: Db, actor: Actor, purchaseOrderId?: string) {
  authorize(actor, "goods.receive");
  const showCosts = hasPermission(actor, "catalogue.costs");
  const [orders, suppliers, warehouses, products] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { status: { in: OPEN_PO_STATUSES } },
      include: { supplier: { select: { name: true } } },
      orderBy: { orderDate: "asc" },
    }),
    db.supplier.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.warehouse.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    showCosts
      ? db.product.findMany({
          where: { status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: {
            id: true,
            sku: true,
            name: true,
            unitsPerPack: true,
            packsPerCarton: true,
            costPrice: true,
          },
        })
      : Promise.resolve([]),
  ]);
  let order = null;
  if (purchaseOrderId && isUuid(purchaseOrderId)) {
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        supplier: { select: { id: true, name: true } },
        lines: {
          orderBy: { position: "asc" },
          include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
        },
      },
    });
    if (po && OPEN_PO_STATUSES.includes(po.status)) {
      order = {
        id: po.id,
        number: po.number,
        supplier: po.supplier,
        warehouseId: po.warehouseId,
        lines: po.lines
          .filter((l) => l.receivedPieces < l.pieces)
          .map((l) => ({
            id: l.id,
            productId: l.productId,
            sku: l.sku,
            description: l.description,
            unit: l.unit,
            ordered: l.quantity,
            outstanding: (l.pieces - l.receivedPieces) / l.piecesPerUnit,
            outstandingText: formatQuantity(l.pieces - l.receivedPieces, l.product),
            unitCost: showCosts ? l.unitCost.toFixed(2) : null,
          })),
      };
    }
  }
  return {
    showCosts,
    today: todayInNairobi(),
    orders: orders.map((o) => ({ id: o.id, number: o.number, supplier: o.supplier.name })),
    order,
    suppliers,
    warehouses,
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unitsPerPack: p.unitsPerPack,
      packsPerCarton: p.packsPerCarton,
      costPerPiece: p.costPrice?.toFixed(2) ?? null,
    })),
  };
}
