import "server-only";

import type Decimal from "decimal.js";

import type { StockMovementType } from "@/generated/prisma/enums";
import { roundMoney, toDecimal } from "@/lib/money";
import { formatQuantity } from "@/lib/units";
import type { DbOrTx } from "@/server/db/client";
import { ConflictError } from "@/server/errors";

export type StockChange = {
  productId: string;
  warehouseId: string;
  /** Pieces; positive adds stock, negative removes it. */
  quantity: number;
  type: StockMovementType;
  /**
   * Cost of the pieces added, KES excl. VAT. Purchases always give it; returns
   * give the cost they left at. Otherwise additions come in at the current
   * average cost (or the product's cost price when there's no stock to average).
   */
  value?: string;
};

export type StockSource = {
  type:
    | "StockAdjustment"
    | "StockTransfer"
    | "StockCount"
    | "Invoice"
    | "InvoiceDeletion"
    | "CreditNote"
    | "GoodsReceipt";
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

/** What a posting did to the value of stock. Costs are signed like the quantities. */
export type StockCostResult = {
  /** Net change in stock value (transfers excluded): positive added, negative removed. */
  total: Decimal;
  /** Per change, in the order given; null for transfers. */
  costs: (Decimal | null)[];
};

const isTransfer = (t: StockMovementType) => t === "TRANSFER_IN" || t === "TRANSFER_OUT";

/**
 * Lock each product's valuation row (creating it if missing) in product order,
 * and read the true total on hand across all warehouses. Every stock change
 * takes these locks first, so the totals can't move underneath us.
 */
export async function lockValuations(
  tx: DbOrTx,
  productIds: string[],
): Promise<Map<string, { quantity: number; value: Decimal; costPrice: Decimal | null }>> {
  const ids = [...new Set(productIds)].sort();
  await tx.$executeRaw`
    INSERT INTO inventory_valuations (product_id, quantity, value, updated_at)
    SELECT p.id, 0, 0, now() FROM products p WHERE p.id = ANY(${ids}::uuid[])
    ON CONFLICT (product_id) DO NOTHING`;
  const out = new Map<string, { quantity: number; value: Decimal; costPrice: Decimal | null }>();
  for (const id of ids) {
    const rows = await tx.$queryRaw<{ value: string; on_hand: number; cost_price: string | null }[]>`
      SELECT v.value::text AS value,
             (SELECT COALESCE(SUM(b.quantity), 0)::int FROM stock_balances b WHERE b.product_id = v.product_id) AS on_hand,
             (SELECT p.cost_price::text FROM products p WHERE p.id = v.product_id) AS cost_price
        FROM inventory_valuations v WHERE v.product_id = ${id}::uuid FOR UPDATE OF v`;
    const r = rows[0]!;
    out.set(id, {
      quantity: r.on_hand,
      value: r.on_hand > 0 ? toDecimal(r.value) : toDecimal(0),
      costPrice: r.cost_price === null ? null : toDecimal(r.cost_price),
    });
  }
  return out;
}

/**
 * The only way stock changes. Inside the caller's transaction it:
 *  1. makes sure a balance row exists for every product/warehouse touched;
 *  2. locks those rows (always in the same order, so two postings can't deadlock);
 *  3. applies every change, refusing the whole posting if any balance would go below zero;
 *  4. values every change at weighted-average cost and keeps each product's
 *     total stock value in step (inventory_valuations);
 *  5. writes one ledger row per change with the resulting balance and its cost.
 * Two people selling or adjusting the same product at the same moment are
 * therefore applied one after the other, never on top of each other.
 * Returns the cost of what moved, so the caller can post it to the ledger.
 */
export async function applyStockChanges(
  tx: DbOrTx,
  changes: StockChange[],
  source: StockSource,
  options: StockOptions = {},
): Promise<StockCostResult> {
  const effective = changes.filter((c) => c.quantity !== 0);
  if (!effective.length) return { total: toDecimal(0), costs: [] };
  for (const c of effective) {
    if (!Number.isSafeInteger(c.quantity)) throw new RangeError("Stock quantities must be whole pieces");
    if (c.value !== undefined && (c.quantity < 0 || toDecimal(c.value).isNegative())) {
      throw new RangeError("A cost can only be given for stock coming in, and can't be negative");
    }
  }

  const valuations = await lockValuations(
    tx,
    effective.map((c) => c.productId),
  );
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

  // Weighted-average costing, change by change.
  const costs: (Decimal | null)[] = [];
  let total = toDecimal(0);
  for (const c of effective) {
    if (isTransfer(c.type)) {
      costs.push(null);
      continue;
    }
    const v = valuations.get(c.productId)!;
    let cost: Decimal;
    if (c.quantity > 0) {
      if (c.value !== undefined) cost = roundMoney(c.value);
      else if (v.quantity > 0 && v.value.greaterThan(0))
        cost = roundMoney(v.value.times(c.quantity).dividedBy(v.quantity));
      else cost = roundMoney((v.costPrice ?? toDecimal(0)).times(c.quantity));
      v.quantity += c.quantity;
      v.value = v.value.plus(cost);
    } else {
      const out = -c.quantity;
      // Taking the last pieces takes all the remaining value, so nothing is left over from rounding.
      const taken = out >= v.quantity ? v.value : roundMoney(v.value.times(out).dividedBy(v.quantity));
      v.quantity -= out;
      v.value = v.value.minus(taken);
      cost = taken.negated();
    }
    costs.push(cost);
    total = total.plus(cost);
  }

  for (const p of pairs) {
    await tx.stockBalance.update({
      where: { productId_warehouseId: { productId: p.productId, warehouseId: p.warehouseId } },
      data: { quantity: balances.get(pairKey(p))! },
    });
  }

  for (const [productId, v] of valuations) {
    await tx.inventoryValuation.update({
      where: { productId },
      data: { quantity: v.quantity, value: v.quantity > 0 ? v.value.toFixed(2) : "0" },
    });
  }

  await tx.stockMovement.createMany({
    data: movements.map((m, i) => ({
      productId: m.productId,
      warehouseId: m.warehouseId,
      type: m.type,
      quantity: m.quantity,
      balanceAfter: m.balanceAfter,
      costValue: costs[i]?.toFixed(2) ?? null,
      sourceType: source.type,
      sourceId: source.id,
      sourceNumber: source.number,
      reason: source.reason ?? null,
      createdById: source.actorId,
    })),
  });
  return { total, costs };
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
