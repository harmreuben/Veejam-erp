import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { fromDbDate, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { calculateLine, sumLines } from "@/lib/sales-math";
import { piecesPerUnit } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { currentTaxRates } from "@/server/modules/sales/pricing";
import { isUuid, parseInput } from "@/server/shared/validation";

import { cancelSchema, PO_STATUS_LABELS, purchaseOrderSchema } from "./schemas";

const auditBase = (actor: Actor, ctx: AuditContext) => ({
  actorUserId: actor.id,
  actorLabel: actor.email,
  ...ctx,
});

/** Statuses that still expect deliveries. */
export const OPEN_PO_STATUSES: PurchaseOrderStatus[] = ["ORDERED", "PARTLY_RECEIVED"];

/**
 * Work out every line from the database: product details, the current tax
 * rate for its category, and the totals. Costs are excluding VAT.
 */
async function buildLines(
  tx: DbOrTx,
  lines: {
    productId: string;
    unit: "PIECE" | "PACK" | "CARTON";
    quantity: number;
    unitCost: string | null;
  }[],
) {
  const products = await tx.product.findMany({ where: { id: { in: lines.map((l) => l.productId) } } });
  const rates = await currentTaxRates(tx);
  const errors: Record<string, string[]> = {};
  const built = lines.map((l, i) => {
    const p = products.find((x) => x.id === l.productId);
    if (!p) {
      errors[`lines.${i}.productId`] = ["This product no longer exists"];
      return null;
    }
    if (p.status !== "ACTIVE") errors[`lines.${i}.productId`] = [`${p.name} is inactive`];
    const rate = rates.get(p.taxCategory);
    if (rate === undefined) {
      errors[`lines.${i}.productId`] = [`No tax rate is set for ${p.name}'s tax category`];
      return null;
    }
    const ppu = piecesPerUnit(l.unit, p);
    const t = calculateLine({ quantity: l.quantity, unitPrice: l.unitCost ?? "0", taxRate: rate }, false);
    return {
      position: i + 1,
      productId: p.id,
      sku: p.sku,
      description: p.name,
      unit: l.unit,
      quantity: l.quantity,
      piecesPerUnit: ppu,
      pieces: l.quantity * ppu,
      unitCost: toDecimal(l.unitCost ?? "0").toFixed(2),
      taxRate: rate,
      netAmount: t.netAmount,
      taxAmount: t.taxAmount,
      grossAmount: t.grossAmount,
    };
  });
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const lineRows = built.filter((l): l is NonNullable<typeof l> => l !== null);
  const totals = sumLines(lineRows.map((l) => ({ ...l, listAmount: "0", discountAmount: "0" })));
  return { lines: lineRows, totals };
}

async function checkParties(tx: DbOrTx, supplierId: string, warehouseId: string) {
  const [supplier, warehouse] = await Promise.all([
    tx.supplier.findUnique({ where: { id: supplierId } }),
    tx.warehouse.findUnique({ where: { id: warehouseId } }),
  ]);
  const errors: Record<string, string[]> = {};
  if (!supplier || supplier.status !== "ACTIVE") errors.supplierId = ["Choose an active supplier"];
  if (!warehouse || warehouse.status !== "ACTIVE") errors.warehouseId = ["Choose an active warehouse"];
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { supplier: supplier!, warehouse: warehouse! };
}

function checkDates(orderDate: string, expectedDate: string | null) {
  if (expectedDate && expectedDate < orderDate) {
    throw new ValidationError({ expectedDate: ["Can't be before the order date"] });
  }
}

export async function createPurchaseOrder(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "purchasing.manage");
  const v = parseInput(purchaseOrderSchema, input);
  checkDates(v.orderDate, v.expectedDate);
  return db.$transaction(async (tx) => {
    const { supplier } = await checkParties(tx, v.supplierId, v.warehouseId);
    const { lines, totals } = await buildLines(tx, v.lines);
    const number = await nextNumber(tx, "PURCHASE_ORDER");
    const po = await tx.purchaseOrder.create({
      data: {
        number,
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        orderDate: toDbDate(v.orderDate),
        expectedDate: v.expectedDate ? toDbDate(v.expectedDate) : null,
        notes: v.notes,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        createdById: actor.id,
        lines: { create: lines },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "PURCHASE_ORDER_CREATED",
      entityType: "PurchaseOrder",
      entityId: po.id,
      summary: `${number} to ${supplier.name}: ${lines.length} line(s), ${formatKES(totals.total)}`,
    });
    return { id: po.id, number };
  });
}

/** Lock an order and check it's the version the person was looking at. */
async function lockOrder(tx: DbOrTx, id: string, version?: number) {
  if (!isUuid(id)) throw new NotFoundError();
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) throw new NotFoundError();
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id },
    include: { supplier: true, lines: true },
  });
  if (version !== undefined && po.version !== version) {
    throw new ConflictError(
      `${po.number} was changed by someone else. Reload the page to see the latest version.`,
    );
  }
  return po;
}

export async function updatePurchaseOrder(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "purchasing.manage");
  const v = parseInput(purchaseOrderSchema, input);
  checkDates(v.orderDate, v.expectedDate);
  return db.$transaction(async (tx) => {
    const po = await lockOrder(tx, id, v.version);
    if (po.status !== "DRAFT") {
      throw new ConflictError(
        `${po.number} has been sent to the supplier and can't be edited. Cancel it and make a new one.`,
      );
    }
    await checkParties(tx, v.supplierId, v.warehouseId);
    const { lines, totals } = await buildLines(tx, v.lines);
    await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: v.supplierId,
        warehouseId: v.warehouseId,
        orderDate: toDbDate(v.orderDate),
        expectedDate: v.expectedDate ? toDbDate(v.expectedDate) : null,
        notes: v.notes,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        version: { increment: 1 },
        lines: { create: lines },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "PURCHASE_ORDER_UPDATED",
      entityType: "PurchaseOrder",
      entityId: id,
      summary: `${po.number}: ${lines.length} line(s), ${formatKES(totals.total)}`,
    });
    return { id, number: po.number };
  });
}

/** Mark a draft as sent to the supplier. From now on it can be received against, not edited. */
export async function markOrdered(db: Db, actor: Actor, id: string, version: number, ctx: AuditContext = {}) {
  authorize(actor, "purchasing.manage");
  return db.$transaction(async (tx) => {
    const po = await lockOrder(tx, id, version);
    if (po.status !== "DRAFT")
      throw new ConflictError(`${po.number} is already ${PO_STATUS_LABELS[po.status].toLowerCase()}.`);
    if (!po.lines.length) throw new ConflictError("Add at least one product first.");
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "ORDERED", orderedAt: new Date(), version: { increment: 1 } },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "PURCHASE_ORDER_ORDERED",
      entityType: "PurchaseOrder",
      entityId: id,
      summary: `${po.number} sent to ${po.supplier.name}`,
    });
    return { number: po.number };
  });
}

/** Cancel an order nothing has been received against. */
export async function cancelPurchaseOrder(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "purchasing.manage");
  const v = parseInput(cancelSchema, input);
  return db.$transaction(async (tx) => {
    const po = await lockOrder(tx, id, v.version);
    if (po.status !== "DRAFT" && po.status !== "ORDERED") {
      throw new ConflictError(
        po.status === "PARTLY_RECEIVED"
          ? `Goods have already been received on ${po.number}. Close it instead to stop expecting the rest.`
          : `${po.number} is ${PO_STATUS_LABELS[po.status].toLowerCase()}.`,
      );
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelReason: v.reason,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "PURCHASE_ORDER_CANCELLED",
      entityType: "PurchaseOrder",
      entityId: id,
      summary: `${po.number} cancelled: ${v.reason}`,
    });
    return { number: po.number };
  });
}

/** Stop expecting the rest of a partly received order. */
export async function closePurchaseOrder(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "purchasing.manage");
  const v = parseInput(cancelSchema, input);
  return db.$transaction(async (tx) => {
    const po = await lockOrder(tx, id, v.version);
    if (po.status !== "PARTLY_RECEIVED") {
      throw new ConflictError(
        `Only a partly received order can be closed; ${po.number} is ${PO_STATUS_LABELS[po.status].toLowerCase()}.`,
      );
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), cancelReason: v.reason, version: { increment: 1 } },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "PURCHASE_ORDER_CLOSED",
      entityType: "PurchaseOrder",
      entityId: id,
      summary: `${po.number} closed with goods outstanding: ${v.reason}`,
    });
    return { number: po.number };
  });
}

// ─── Reading ────────────────────────────────────────────────────────

const money = (show: boolean, d: { toFixed(n: number): string } | null | undefined) =>
  show && d ? d.toFixed(2) : null;

export async function listPurchaseOrders(
  db: Db,
  actor: Actor,
  filter: { q?: string; status?: string; supplierId?: string } = {},
) {
  authorize(actor, "purchasing.view");
  const showCosts = hasPermission(actor, "catalogue.costs");
  const where: Prisma.PurchaseOrderWhereInput = {};
  if (filter.status === "OPEN") where.status = { in: [...OPEN_PO_STATUSES, "DRAFT"] };
  else if (filter.status && filter.status in PO_STATUS_LABELS)
    where.status = filter.status as PurchaseOrderStatus;
  if (filter.supplierId && isUuid(filter.supplierId)) where.supplierId = filter.supplierId;
  if (filter.q) {
    where.OR = [
      { number: { contains: filter.q, mode: "insensitive" } },
      { supplier: { name: { contains: filter.q, mode: "insensitive" } } },
    ];
  }
  const rows = await db.purchaseOrder.findMany({
    where,
    include: { supplier: { select: { name: true, code: true } }, warehouse: { select: { name: true } } },
    orderBy: [{ orderDate: "desc" }, { number: "desc" }],
    take: 200,
  });
  return {
    showCosts,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      supplier: r.supplier.name,
      warehouse: r.warehouse.name,
      orderDate: fromDbDate(r.orderDate),
      expectedDate: r.expectedDate ? fromDbDate(r.expectedDate) : null,
      total: money(showCosts, r.total),
    })),
  };
}

export async function getPurchaseOrder(db: Db, actor: Actor, id: string) {
  authorize(actor, "purchasing.view");
  if (!isUuid(id)) throw new NotFoundError();
  const showCosts = hasPermission(actor, "catalogue.costs");
  const po = await db.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      warehouse: { select: { id: true, name: true } },
      createdBy: { select: { fullName: true } },
      lines: {
        orderBy: { position: "asc" },
        include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
      },
      receipts: {
        orderBy: { postedAt: "asc" },
        select: { id: true, number: true, receivedOn: true, totalCost: true },
      },
    },
  });
  if (!po) throw new NotFoundError();
  return {
    showCosts,
    id: po.id,
    number: po.number,
    status: po.status,
    version: po.version,
    supplier: {
      id: po.supplier.id,
      name: po.supplier.name,
      code: po.supplier.code,
      phone: po.supplier.phone,
      email: po.supplier.email,
      kraPin: po.supplier.kraPin,
      address: po.supplier.physicalAddress,
    },
    warehouse: po.warehouse,
    orderDate: fromDbDate(po.orderDate),
    expectedDate: po.expectedDate ? fromDbDate(po.expectedDate) : null,
    notes: po.notes,
    createdBy: po.createdBy.fullName,
    createdAt: po.createdAt,
    orderedAt: po.orderedAt,
    cancelledAt: po.cancelledAt,
    closedAt: po.closedAt,
    cancelReason: po.cancelReason,
    subtotal: money(showCosts, po.subtotal),
    taxTotal: money(showCosts, po.taxTotal),
    total: money(showCosts, po.total),
    lines: po.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      sku: l.sku,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      piecesPerUnit: l.piecesPerUnit,
      pieces: l.pieces,
      receivedPieces: l.receivedPieces,
      sizes: l.product,
      unitCost: money(showCosts, l.unitCost),
      taxRate: l.taxRate.toFixed(4),
      netAmount: money(showCosts, l.netAmount),
      taxAmount: money(showCosts, l.taxAmount),
      grossAmount: money(showCosts, l.grossAmount),
    })),
    receipts: po.receipts.map((r) => ({
      id: r.id,
      number: r.number,
      receivedOn: fromDbDate(r.receivedOn),
      totalCost: money(showCosts, r.totalCost),
    })),
  };
}

/** Suppliers, warehouses and products (with last cost per piece) for the order form. */
export async function purchaseOrderFormData(db: Db, actor: Actor) {
  authorize(actor, "purchasing.manage");
  const [suppliers, warehouses, products] = await Promise.all([
    db.supplier.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.warehouse.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        unitsPerPack: true,
        packsPerCarton: true,
        costPrice: true,
        taxCategory: true,
      },
    }),
  ]);
  const rates = await currentTaxRates(db);
  return {
    suppliers,
    warehouses,
    today: todayInNairobi(),
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unitsPerPack: p.unitsPerPack,
      packsPerCarton: p.packsPerCarton,
      costPerPiece: p.costPrice?.toFixed(2) ?? null,
      taxRate: rates.get(p.taxCategory) ?? "0",
    })),
  };
}
