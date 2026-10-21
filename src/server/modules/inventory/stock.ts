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
  type: "StockAdjustment" | "StockTransfer" | "StockCount";
  id: string;
  number: string;
  reason?: string | null;
  actorId: string | null;
};

const pairKey = (c: { productId: string; warehouseId: string }) => `${c.productId}|${c.warehouseId}`;

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
): Promise<void> {
  const effective = changes.filter((c) => c.quantity !== 0);
  if (!effective.length) return;
  for (const c of effective) {
    if (!Number.isSafeInteger(c.quantity)) throw new RangeError("Stock quantities must be whole pieces");
  }

  const pairs = [...new Map(effective.map((c) => [pairKey(c), c])).values()].sort((a, b) =>
    pairKey(a).localeCompare(pairKey(b)),
  );

  await tx.stockBalance.createMany({
    data: pairs.map((p) => ({ productId: p.productId, warehouseId: p.warehouseId, quantity: 0 })),
    skipDuplicates: true,
  });

  const balances = new Map<string, number>();
  for (const p of pairs) {
    const rows = await tx.$queryRaw<{ quantity: number }[]>`
      SELECT quantity FROM stock_balances
       WHERE product_id = ${p.productId}::uuid AND warehouse_id = ${p.warehouseId}::uuid
       FOR UPDATE`;
    balances.set(pairKey(p), rows[0]?.quantity ?? 0);
  }

  const movements: {
    productId: string;
    warehouseId: string;
    type: StockMovementType;
    quantity: number;
    balanceAfter: number;
  }[] = [];
  const short: { productId: string; warehouseId: string; available: number; needed: number }[] = [];
  for (const c of effective) {
    const before = balances.get(pairKey(c))!;
    const after = before + c.quantity;
    if (after < 0)
      short.push({
        productId: c.productId,
        warehouseId: c.warehouseId,
        available: before,
        needed: -c.quantity,
      });
    balances.set(pairKey(c), after);
    movements.push({ ...c, balanceAfter: after });
  }

  if (short.length) {
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
      return `${p.sku} ${p.name}: ${w.name} has ${formatQuantity(s.available, p)}, this needs ${formatQuantity(s.needed, p)}`;
    });
    throw new ConflictError(`Not enough stock. ${lines.join("; ")}. Nothing was changed.`);
  }

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
