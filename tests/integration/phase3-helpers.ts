import { randomUUID } from "node:crypto";

import type { Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { createProduct } from "@/server/modules/catalogue/service";
import { postAdjustment } from "@/server/modules/inventory/documents";

let n = 0;

/** A test product. Pack sizes are illustrative, not real Wrigley data. */
export async function makeProduct(
  db: Db,
  owner: Actor,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; sku: string; name: string }> {
  n++;
  return createProduct(db, owner, {
    sku: `TEST-${n}`,
    name: `Test product ${n}`,
    brand: "Test brand",
    category: "Test category",
    unitsPerPack: 10,
    packsPerCarton: 20,
    ...overrides,
  });
}

export async function mainWarehouse(db: Db) {
  return db.warehouse.findFirstOrThrow({ where: { code: "MAIN" } });
}

export async function addStock(db: Db, owner: Actor, productId: string, warehouseId: string, pieces: number) {
  return postAdjustment(db, owner, {
    warehouseId,
    reason: "OPENING_BALANCE",
    idempotencyKey: randomUUID(),
    lines: [{ productId, direction: "IN", unit: "PIECE", quantity: pieces }],
  });
}

export async function balance(db: Db, productId: string, warehouseId: string): Promise<number> {
  const b = await db.stockBalance.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });
  return b?.quantity ?? 0;
}
