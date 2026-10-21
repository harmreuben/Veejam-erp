import "server-only";

import type { StockMovementType } from "@/generated/prisma/enums";
import { formatQuantity } from "@/lib/units";
import type { DbOrTx } from "@/server/db/client";
import { ConflictError } from "@/server/errors";

export type StockChange = {
  productId: string;
  warehouseId: string;
  /** Pieces; positive adds stock, negative removes it. */
  quantity: number;
  type: StockMovementType;
};

export type StockSource = {
  type: "StockAdjustment" | "StockTransfer" | "StockCount" | "Invoice" | "CreditNote";
  id: string;
  number: string;
  reason?: string | null;
  actorId: string | null;
};

const pairKey = (c: { productId: string; warehouseId: string }) => `${c.productId}|${c.warehouseId}`;
type Pair = { productId: string; warehouseId: string };

export type StockOptions = {
  /**
   * Also keep stock reserved for confirmed sales orders: a removal may only use
   * stock that isn't promised to someone else. Used by invoices and transfers.
   * Adjustments and counts record what physically happened, so they don't.
   */
  respectReservations?: boolean;
};

/** Make sure balance rows exist, then lock them in a fixed order (no deadlocks). Returns pieces on hand. */
async function lockBalances(
  tx: DbOrTx,
  items: Pair[],
): Promise<{ pairs: Pair[]; onHand: Map<string, number> }> {
  const pairs = [
    ...new Map(
      items.map((c) => [pairKey(c), { productId: c.productId, warehouseId: c.warehouseId }]),
    ).values(),
  ].sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
  await tx.stockBalance.createMany({
    data: pairs.map((p) => ({ productId: p.productId, warehouseId: p.warehouseId, quantity: 0 })),
    skipDuplicates: true,
  });
  const onHand = new Map<string, number>();
  for (const p of pairs) {
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      SELECT quantity FROM stock_balances
       WHERE product_id = ${p.productId}::uuid AND warehouse_id = ${p.warehouseId}::uuid
       FOR UPDATE`;
    onHand.set(pairKey(p), rows[0]?.quantity ?? 0);
  }
  return { pairs, onHand };
}

/** Pieces reserved by confirmed orders, per product/warehouse. Call after lockBalances. */
async function reservedFor(tx: DbOrTx, pairs: Pair[]): Promise<Map<string, number>> {
  const rows = await tx.stockReservation.groupBy({
    by: ["productId", "warehouseId"],
    where: { OR: pairs.map((p) => ({ productId: p.productId, warehouseId: p.warehouseId })) },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [pairKey(r), r._sum.quantity ?? 0]));
}

type Shortage = Pair & { onHand: number; reserved: number; needed: number };

async function shortageError(
  tx: DbOrTx,
  short: Shortage[],
  prefix = "Not enough stock",
): Promise<ConflictError> {
  const products = await tx.product.findMany({
    where: { id: { in: short.map((s) => s.productId) } },
    select: { id: true, sku: true, name: true, unitsPerPack: true, packsPerCarton: true },
  });
  const warehouses = await tx.warehouse.findMany({
    where: { id: { in: short.map((s) => s.warehouseId) } },
    select: { id: true, name: true },
  });
  const lines = short.map((s) => {
    const p = products.find((x) => x.id === s.productId)!;
    const w = warehouses.find((x) => x.id === s.warehouseId)!;
    const held = s.reserved
      ? `${formatQuantity(s.onHand, p)} of which ${formatQuantity(s.reserved, p)} is reserved for confirmed orders`
      : formatQuantity(s.onHand, p);
    return `${p.sku} ${p.name}: ${w.name} has ${held}, this needs ${formatQuantity(s.needed, p)}`;
  });
  return new ConflictError(`${prefix}. ${lines.join("; ")}. Nothing was changed.`);
}

/**
 * The only way stock changes. Inside the caller's transaction it:
 *  1. makes sure a balance row exists for every product/warehouse touched;
 *  2. locks those rows (always in the same order, so two postings can't deadlock);
 *  3. applies every change, refusing the whole posting if any balance would go below zero;
 *  4. writes one ledger row per change with the resulting balance.
 * Two people selling or adjusting the same product at the same moment are
 * therefore applied one after the other, never on top of each other.
 */
export async function applyStockChanges(
  tx: DbOrTx,
  changes: StockChange[],
  source: StockSource,
  options: StockOptions = {},
): Promise<void> {
  const effective = changes.filter((c) => c.quantity !== 0);
  if (!effective.length) return;
  for (const c of effective) {
    if (!Number.isSafeInteger(c.quantity)) throw new RangeError("Stock quantities must be whole pieces");
  }

  const { pairs, onHand } = await lockBalances(tx, effective);
  const reserved = options.respectReservations ? await reservedFor(tx, pairs) : new Map<string, number>();
  const balances = new Map(onHand);

  const movements: {
    productId: string;
    warehouseId: string;
    type: StockMovementType;
    quantity: number;
    balanceAfter: number;
  }[] = [];
  const short = new Map<string, Shortage>();
  for (const c of effective) {
    const key = pairKey(c);
    const after = balances.get(key)! + c.quantity;
    const held = reserved.get(key) ?? 0;
    if (c.quantity < 0 && after < held) {
      const s = short.get(key) ?? {
        productId: c.productId,
        warehouseId: c.warehouseId,
        onHand: onHand.get(key)!,
        reserved: held,
        needed: 0,
      };
      s.needed += -c.quantity;
      short.set(key, s);
    }
    balances.set(key, after);
    movements.push({ ...c, balanceAfter: after });
  }

  if (short.size) throw await shortageError(tx, [...short.values()]);

  for (const p of pairs) {
    await tx.stockBalance.update({
      where: { productId_warehouseId: { productId: p.productId, warehouseId: p.warehouseId } },
      data: { quantity: balances.get(pairKey(p))! },
    });
  }

  await tx.stockMovement.createMany({
    data: movements.map((m) => ({
      ...m,
      sourceType: source.type,
      sourceId: source.id,
      sourceNumber: source.number,
      reason: source.reason ?? null,
      createdById: source.actorId,
    })),
  });
}

/** True for Postgres unique violations, however the driver adapter wraps them. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string }; message?: string } | null;
  return (
    e?.code === "P2002" ||
    e?.code === "23505" ||
    e?.cause?.code === "23505" ||
    /unique constraint/i.test(e?.message ?? "")
  );
}

/**
 * Reserve stock for a confirmed sales order. Locks the same balance rows as a
 * posting, so a reservation and a sale can't both take the last cartons.
 */
export async function reserveStock(
  tx: DbOrTx,
  documentId: string,
  items: (Pair & { quantity: number })[],
): Promise<void> {
  const wanted = new Map<string, Pair & { quantity: number }>();
  for (const i of items) {
    const key = pairKey(i);
    const w = wanted.get(key) ?? { productId: i.productId, warehouseId: i.warehouseId, quantity: 0 };
    w.quantity += i.quantity;
    wanted.set(key, w);
  }
  if (!wanted.size) return;
  const { pairs, onHand } = await lockBalances(tx, [...wanted.values()]);
  const reserved = await reservedFor(tx, pairs);
  const short: Shortage[] = [];
  for (const w of wanted.values()) {
    const key = pairKey(w);
    const available = onHand.get(key)! - (reserved.get(key) ?? 0);
    if (w.quantity > available)
      short.push({ ...w, onHand: onHand.get(key)!, reserved: reserved.get(key) ?? 0, needed: w.quantity });
  }
  if (short.length) throw await shortageError(tx, short, "Not enough stock to reserve");
  await tx.stockReservation.createMany({
    data: [...wanted.values()].map((w) => ({ documentId, ...w })),
  });
}

/** Release everything reserved for a document (order invoiced or cancelled). */
export async function releaseReservations(tx: DbOrTx, documentId: string): Promise<void> {
  await tx.stockReservation.deleteMany({ where: { documentId } });
}

/** Pieces on hand, reserved and available, for a set of products in one warehouse. */
export async function availability(
  db: DbOrTx,
  warehouseId: string,
  productIds: string[],
): Promise<Map<string, { onHand: number; reserved: number; available: number }>> {
  const [balances, reservations] = await Promise.all([
    db.stockBalance.findMany({ where: { warehouseId, productId: { in: productIds } } }),
    db.stockReservation.groupBy({
      by: ["productId"],
      where: { warehouseId, productId: { in: productIds } },
      _sum: { quantity: true },
    }),
  ]);
  const result = new Map<string, { onHand: number; reserved: number; available: number }>();
  for (const id of productIds) {
    const onHand = balances.find((b) => b.productId === id)?.quantity ?? 0;
    const reserved = reservations.find((r) => r.productId === id)?._sum.quantity ?? 0;
    result.set(id, { onHand, reserved, available: onHand - reserved });
  }
  return result;
}
