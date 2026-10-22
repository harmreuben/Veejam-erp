import "server-only";

import { todayInNairobi } from "@/lib/dates";
import { piecesPerUnit } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { postStockValue } from "@/server/modules/accounting/journal";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { saveCountSchema, startCountSchema } from "./schemas";
import { applyStockChanges } from "./stock";

/**
 * Start a count for one warehouse. Lists every active product plus anything
 * still holding stock there, with the quantity the system expects.
 * Only one open count per warehouse at a time.
 */
export async function startCount(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "inventory.count");
  const values = parseInput(startCountSchema, input);
  return db.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findUnique({ where: { id: values.warehouseId } });
    if (!warehouse || warehouse.status !== "ACTIVE")
      throw new ValidationError({ warehouseId: ["Choose an active warehouse"] });
    // Lock the warehouse row so two people can't start counts for it at the same moment.
    await tx.$queryRaw`SELECT id FROM warehouses WHERE id = ${warehouse.id}::uuid FOR UPDATE`;
    const open = await tx.stockCount.findFirst({ where: { warehouseId: warehouse.id, status: "DRAFT" } });
    if (open)
      throw new ConflictError(
        `Count ${open.number} is still open for ${warehouse.name}. Post or cancel it first.`,
      );

    const products = await tx.product.findMany({
      where: {
        OR: [
          { status: "ACTIVE" },
          { balances: { some: { warehouseId: warehouse.id, quantity: { gt: 0 } } } },
        ],
      },
      select: { id: true, balances: { where: { warehouseId: warehouse.id }, select: { quantity: true } } },
      orderBy: [{ brand: "asc" }, { name: "asc" }],
    });
    if (!products.length) throw new ConflictError("There are no products to count yet. Add products first.");

    const number = await nextNumber(tx, "STOCK_COUNT");
    const count = await tx.stockCount.create({
      data: {
        number,
        warehouseId: warehouse.id,
        notes: values.notes,
        createdById: actor.id,
        lines: {
          create: products.map((p) => ({ productId: p.id, expectedQuantity: p.balances[0]?.quantity ?? 0 })),
        },
      },
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "STOCK_COUNT_STARTED",
      entityType: "StockCount",
      entityId: count.id,
      summary: `${number} ${warehouse.name}, ${products.length} products`,
      ...ctx,
    });
    return count;
  });
}

/** Save counted quantities (cartons + packs + loose pieces per line). Blank everywhere = not counted. */
export async function saveCount(db: Db, actor: Actor, countId: string, input: unknown) {
  authorize(actor, "inventory.count");
  const values = parseInput(saveCountSchema, input);
  return db.$transaction(async (tx) => {
    const updated = await tx.stockCount.updateMany({
      where: { id: countId, status: "DRAFT", version: values.version },
      data: { version: { increment: 1 } },
    });
    if (updated.count === 0) {
      const count = await tx.stockCount.findUnique({ where: { id: countId } });
      if (!count) throw new NotFoundError("That count no longer exists.");
      if (count.status !== "DRAFT")
        throw new ConflictError(`This count is already ${count.status.toLowerCase()}.`);
      throw new ConflictError("Someone else saved this count. Reload the page to see their figures.");
    }
    const lines = await tx.stockCountLine.findMany({
      where: { countId },
      include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
    });
    const byProduct = new Map(lines.map((l) => [l.productId, l]));
    for (const entry of values.lines) {
      const line = byProduct.get(entry.productId);
      if (!line) throw new ConflictError("A product on the form isn't part of this count. Reload the page.");
      const blank = entry.cartons === null && entry.packs === null && entry.pieces === null;
      const counted = blank
        ? null
        : (entry.cartons ?? 0) * piecesPerUnit("CARTON", line.product) +
          (entry.packs ?? 0) * piecesPerUnit("PACK", line.product) +
          (entry.pieces ?? 0);
      if (counted !== line.countedQuantity) {
        await tx.stockCountLine.update({ where: { id: line.id }, data: { countedQuantity: counted } });
      }
    }
    return tx.stockCount.findUniqueOrThrow({ where: { id: countId } });
  });
}

/**
 * Post a count: each counted product's balance becomes exactly the counted
 * quantity. The difference from the balance at this moment is recorded as a
 * COUNT_GAIN or COUNT_LOSS movement. Uncounted lines are left unchanged.
 */
export async function postCount(
  db: Db,
  actor: Actor,
  countId: string,
  version: number,
  ctx: AuditContext = {},
) {
  authorize(actor, "inventory.count.post");
  return db.$transaction(async (tx) => {
    const claimed = await tx.stockCount.updateMany({
      where: { id: countId, status: "DRAFT", version },
      data: { status: "POSTED", postedAt: new Date(), postedById: actor.id, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const count = await tx.stockCount.findUnique({ where: { id: countId } });
      if (!count) throw new NotFoundError("That count no longer exists.");
      if (count.status !== "DRAFT")
        throw new ConflictError(`This count is already ${count.status.toLowerCase()}.`);
      throw new ConflictError(
        "Someone changed this count since you opened it. Reload, check the figures, then post.",
      );
    }
    const count = await tx.stockCount.findUniqueOrThrow({
      where: { id: countId },
      include: { warehouse: true },
    });
    const counted = await tx.stockCountLine.findMany({ where: { countId, countedQuantity: { not: null } } });
    if (!counted.length)
      throw new ValidationError({ form: ["Enter at least one counted quantity before posting."] });

    // Lock the balances, then read what the system holds right now.
    await tx.stockBalance.createMany({
      data: counted.map((l) => ({ productId: l.productId, warehouseId: count.warehouseId, quantity: 0 })),
      skipDuplicates: true,
    });
    const current = new Map<string, number>();
    for (const l of [...counted].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const rows = await tx.$queryRaw<{ quantity: number }[]>`
        SELECT quantity FROM stock_balances
         WHERE product_id = ${l.productId}::uuid AND warehouse_id = ${count.warehouseId}::uuid FOR UPDATE`;
      current.set(l.productId, rows[0]?.quantity ?? 0);
    }

    const changes = [];
    for (const l of counted) {
      const system = current.get(l.productId)!;
      await tx.stockCountLine.update({ where: { id: l.id }, data: { systemQuantityAtPost: system } });
      const variance = l.countedQuantity! - system;
      if (variance !== 0) {
        changes.push({
          productId: l.productId,
          warehouseId: count.warehouseId,
          quantity: variance,
          type: variance > 0 ? ("COUNT_GAIN" as const) : ("COUNT_LOSS" as const),
        });
      }
    }
    const stock = await applyStockChanges(tx, changes, {
      type: "StockCount",
      id: count.id,
      number: count.number,
      reason: "Stock count",
      actorId: actor.id,
    });
    await postStockValue(tx, {
      change: stock.total,
      against: "STOCK_ADJ",
      date: todayInNairobi(),
      description: `Stock count ${count.number}: differences found`,
      sourceType: "StockCount",
      sourceId: count.id,
      sourceNumber: count.number,
      actorId: actor.id,
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "STOCK_COUNT_POSTED",
      entityType: "StockCount",
      entityId: count.id,
      summary: `${count.number} ${count.warehouse.name}: ${counted.length} counted, ${changes.length} changed`,
      after: { variances: changes.map((c) => ({ productId: c.productId, pieces: c.quantity })) },
      ...ctx,
    });
    return { number: count.number, counted: counted.length, changed: changes.length };
  });
}

export async function cancelCount(db: Db, actor: Actor, countId: string, ctx: AuditContext = {}) {
  authorize(actor, "inventory.count");
  return db.$transaction(async (tx) => {
    const updated = await tx.stockCount.updateMany({
      where: { id: countId, status: "DRAFT" },
      data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 } },
    });
    if (updated.count === 0) throw new ConflictError("Only an open count can be cancelled.");
    const count = await tx.stockCount.findUniqueOrThrow({ where: { id: countId } });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "STOCK_COUNT_CANCELLED",
      entityType: "StockCount",
      entityId: countId,
      summary: `${count.number} cancelled`,
      ...ctx,
    });
  });
}
