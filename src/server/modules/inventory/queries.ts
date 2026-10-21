import "server-only";

import type { StockMovementType } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { warehouseSchema } from "./schemas";

// ─── Warehouses ───────────────────────────────────────────────────

export async function listWarehouses(db: Db, actor: Actor, opts: { activeOnly?: boolean } = {}) {
  authorize(actor, "inventory.view");
  const rows = await db.warehouse.findMany({
    where: opts.activeOnly ? { status: "ACTIVE" } : {},
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: { balances: { select: { quantity: true } } },
  });
  return rows.map(({ balances, ...w }) => ({
    ...w,
    totalPieces: balances.reduce((s, b) => s + b.quantity, 0),
    productsInStock: balances.filter((b) => b.quantity > 0).length,
  }));
}

export async function saveWarehouse(
  db: Db,
  actor: Actor,
  id: string | null,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "warehouses.manage");
  const values = parseInput(warehouseSchema, input);
  return db.$transaction(async (tx) => {
    const sameCode = await tx.warehouse.findUnique({ where: { code: values.code } });
    if (sameCode && sameCode.id !== id)
      throw new ValidationError({ code: ["Another warehouse already uses this code"] });
    if (!id) {
      const w = await tx.warehouse.create({ data: values });
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "WAREHOUSE_CREATED",
        entityType: "Warehouse",
        entityId: w.id,
        summary: `${w.code} ${w.name}`,
        after: values,
        ...ctx,
      });
      return w;
    }
    const current = await tx.warehouse.findUnique({ where: { id }, include: { balances: true } });
    if (!current) throw new NotFoundError("That warehouse no longer exists.");
    if (values.status === "INACTIVE" && current.balances.some((b) => b.quantity > 0)) {
      throw new ConflictError(
        "This warehouse still holds stock. Transfer or adjust it to zero before deactivating.",
      );
    }
    const w = await tx.warehouse.update({ where: { id }, data: values });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "WAREHOUSE_UPDATED",
      entityType: "Warehouse",
      entityId: id,
      summary: `${w.code} ${w.name}`,
      before: { code: current.code, name: current.name, location: current.location, status: current.status },
      after: values,
      ...ctx,
    });
    return w;
  });
}

// ─── Stock levels and history ─────────────────────────────────────

export async function stockLevels(db: Db, actor: Actor, filter: { q?: string; lowOnly?: boolean } = {}) {
  authorize(actor, "inventory.view");
  const q = filter.q?.trim();
  const [warehouses, products] = await Promise.all([
    db.warehouse.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.product.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { brand: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        OR: [{ status: "ACTIVE" }, { balances: { some: { quantity: { gt: 0 } } } }],
      },
      orderBy: [{ brand: "asc" }, { name: "asc" }],
      select: {
        id: true,
        sku: true,
        name: true,
        brand: true,
        status: true,
        unitsPerPack: true,
        packsPerCarton: true,
        reorderLevel: true,
        balances: { select: { warehouseId: true, quantity: true } },
      },
    }),
  ]);
  const rows = products.map(({ balances, ...p }) => {
    const byWarehouse = Object.fromEntries(balances.map((b) => [b.warehouseId, b.quantity]));
    const total = balances.reduce((s, b) => s + b.quantity, 0);
    return { ...p, byWarehouse, total, low: p.status === "ACTIVE" && total <= p.reorderLevel };
  });
  return { warehouses, rows: filter.lowOnly ? rows.filter((r) => r.low) : rows };
}

export async function listMovements(
  db: Db,
  actor: Actor,
  filter: { productId?: string; warehouseId?: string; type?: StockMovementType; take?: number } = {},
) {
  authorize(actor, "inventory.view");
  return db.stockMovement.findMany({
    where: {
      ...(filter.productId ? { productId: filter.productId } : {}),
      ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: { id: "desc" },
    take: Math.min(filter.take ?? 200, 1000),
    include: {
      product: { select: { id: true, sku: true, name: true, unitsPerPack: true, packsPerCarton: true } },
      warehouse: { select: { code: true, name: true } },
      createdBy: { select: { fullName: true } },
    },
  });
}

// ─── Documents ────────────────────────────────────────────────────

export async function listAdjustments(db: Db, actor: Actor) {
  authorize(actor, "inventory.view");
  return db.stockAdjustment.findMany({
    orderBy: { postedAt: "desc" },
    take: 200,
    include: {
      warehouse: { select: { name: true } },
      postedBy: { select: { fullName: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getAdjustment(db: Db, actor: Actor, id: string) {
  authorize(actor, "inventory.view");
  const a = await db.stockAdjustment.findUnique({
    where: { id },
    include: {
      warehouse: true,
      postedBy: { select: { fullName: true } },
      lines: {
        include: { product: { select: { sku: true, name: true, unitsPerPack: true, packsPerCarton: true } } },
      },
    },
  });
  if (!a) throw new NotFoundError("That adjustment doesn't exist.");
  return a;
}

export async function listTransfers(db: Db, actor: Actor) {
  authorize(actor, "inventory.view");
  return db.stockTransfer.findMany({
    orderBy: { postedAt: "desc" },
    take: 200,
    include: {
      fromWarehouse: { select: { name: true } },
      toWarehouse: { select: { name: true } },
      postedBy: { select: { fullName: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getTransfer(db: Db, actor: Actor, id: string) {
  authorize(actor, "inventory.view");
  const t = await db.stockTransfer.findUnique({
    where: { id },
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      postedBy: { select: { fullName: true } },
      lines: {
        include: { product: { select: { sku: true, name: true, unitsPerPack: true, packsPerCarton: true } } },
      },
    },
  });
  if (!t) throw new NotFoundError("That transfer doesn't exist.");
  return t;
}

export async function listCounts(db: Db, actor: Actor) {
  authorize(actor, "inventory.view");
  return db.stockCount.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      warehouse: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getCount(db: Db, actor: Actor, id: string) {
  authorize(actor, "inventory.view");
  const c = await db.stockCount.findUnique({
    where: { id },
    include: {
      warehouse: true,
      createdBy: { select: { fullName: true } },
      postedBy: { select: { fullName: true } },
      lines: {
        include: {
          product: {
            select: { sku: true, name: true, brand: true, unitsPerPack: true, packsPerCarton: true },
          },
        },
      },
    },
  });
  if (!c) throw new NotFoundError("That count doesn't exist.");
  c.lines.sort((a, b) => (a.product.brand + a.product.name).localeCompare(b.product.brand + b.product.name));
  return c;
}

/** Products for line editors: active ones, plus (optionally) inactive ones still holding stock. */
export async function productOptions(db: Db, actor: Actor, opts: { includeInactiveWithStock: boolean }) {
  authorize(actor, "inventory.view");
  const rows = await db.product.findMany({
    where: opts.includeInactiveWithStock
      ? { OR: [{ status: "ACTIVE" }, { balances: { some: { quantity: { gt: 0 } } } }] }
      : { status: "ACTIVE" },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      unitsPerPack: true,
      packsPerCarton: true,
      balances: { select: { warehouseId: true, quantity: true } },
    },
  });
  return rows.map(({ balances, ...p }) => ({
    ...p,
    stock: Object.fromEntries(balances.map((b) => [b.warehouseId, b.quantity])) as Record<string, number>,
  }));
}
