import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { cancelCount, postCount, saveCount, startCount } from "@/server/modules/inventory/counts";
import { postAdjustment, postTransfer } from "@/server/modules/inventory/documents";
import { saveWarehouse, stockLevels } from "@/server/modules/inventory/queries";
import { applySeed } from "@/server/seed";

import { clearTestData, rawQuery } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, balance, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

describe("stock adjustments", () => {
  it("converts cartons/packs to pieces, updates the balance and writes the ledger", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    const res = await postAdjustment(db, owner, {
      warehouseId: main.id,
      reason: "OPENING_BALANCE",
      idempotencyKey: randomUUID(),
      lines: [{ productId: p.id, direction: "IN", unit: "CARTON", quantity: 2 }],
    });
    expect(res.number).toBe("ADJ-000001");
    expect(await balance(db, p.id, main.id)).toBe(400);
    const moves = await db.stockMovement.findMany({ where: { productId: p.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      type: "ADJUSTMENT_IN",
      quantity: 400,
      balanceAfter: 400,
      sourceNumber: "ADJ-000001",
    });
    expect(await db.auditLog.count({ where: { action: "STOCK_ADJUSTED" } })).toBe(1);
  });

  it("refuses to take stock below zero and changes nothing", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    await addStock(db, owner, p.id, main.id, 15);
    const error = await postAdjustment(db, owner, {
      warehouseId: main.id,
      reason: "DAMAGED",
      idempotencyKey: randomUUID(),
      lines: [{ productId: p.id, direction: "OUT", unit: "PACK", quantity: 2 }],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toMatch(/Not enough stock.*has 15 pcs.*needs 20 pcs/);
    expect(await balance(db, p.id, main.id)).toBe(15);
    expect(await db.stockAdjustment.count()).toBe(1);
    // The failed attempt didn't use up a number.
    const next = await addStock(db, owner, p.id, main.id, 1);
    expect(next.number).toBe("ADJ-000002");
  });

  it("the same form submitted twice posts once", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    const input = {
      warehouseId: main.id,
      reason: "OPENING_BALANCE",
      idempotencyKey: randomUUID(),
      lines: [{ productId: p.id, direction: "IN", unit: "PIECE", quantity: 50 }],
    };
    const results = await Promise.all([postAdjustment(db, owner, input), postAdjustment(db, owner, input)]);
    expect(results.map((r) => r.number)).toEqual(["ADJ-000001", "ADJ-000001"]);
    expect(results.filter((r) => r.alreadyPosted)).toHaveLength(1);
    expect(await balance(db, p.id, main.id)).toBe(50);
  });

  it("many simultaneous removals can never oversell", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    await addStock(db, owner, p.id, main.id, 10);
    const attempts = Array.from({ length: 8 }, () =>
      postAdjustment(db, owner, {
        warehouseId: main.id,
        reason: "DAMAGED",
        idempotencyKey: randomUUID(),
        lines: [{ productId: p.id, direction: "OUT", unit: "PIECE", quantity: 3 }],
      }),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3); // 3 × 3 = 9 ≤ 10
    expect(await balance(db, p.id, main.id)).toBe(1);
    const ledger = await rawQuery<{ total: string }>(
      "SELECT sum(quantity)::text AS total FROM stock_movements",
    );
    expect(Number(ledger[0]!.total)).toBe(1); // ledger and balance agree
  });

  it("enforces reason rules and permissions", async () => {
    const owner = await makeUser(db, "OWNER");
    const store = await makeUser(db, "STOREKEEPER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    await expect(
      postAdjustment(db, owner, {
        warehouseId: main.id,
        reason: "DAMAGED",
        idempotencyKey: randomUUID(),
        lines: [{ productId: p.id, direction: "IN", unit: "PIECE", quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      postAdjustment(db, owner, {
        warehouseId: main.id,
        reason: "CORRECTION",
        idempotencyKey: randomUUID(),
        lines: [{ productId: p.id, direction: "IN", unit: "PIECE", quantity: 1 }],
      }),
    ).rejects.toThrow(); // a correction needs an explanation
    await expect(addStock(db, store, p.id, main.id, 5)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the ledger can't be edited or deleted", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    await addStock(db, owner, p.id, main.id, 5);
    await expect(rawQuery("UPDATE stock_movements SET quantity = 500")).rejects.toThrow(/append-only/);
    await expect(rawQuery("DELETE FROM stock_movements")).rejects.toThrow(/append-only/);
    await expect(rawQuery("UPDATE stock_balances SET quantity = -1")).rejects.toThrow(
      /stock_balances_quantity_chk/,
    );
  });
});

describe("transfers", () => {
  it("moves stock between warehouses atomically", async () => {
    const owner = await makeUser(db, "OWNER");
    const store = await makeUser(db, "STOREKEEPER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    const van = await saveWarehouse(db, owner, null, { code: "VAN1", name: "Delivery van 1" });
    await addStock(db, owner, p.id, main.id, 300);

    const t = await postTransfer(db, store, {
      fromWarehouseId: main.id,
      toWarehouseId: van.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: p.id, unit: "CARTON", quantity: 1 }],
    });
    expect(t.number).toBe("TRF-000001");
    expect(await balance(db, p.id, main.id)).toBe(100);
    expect(await balance(db, p.id, van.id)).toBe(200);

    await expect(
      postTransfer(db, store, {
        fromWarehouseId: van.id,
        toWarehouseId: main.id,
        idempotencyKey: randomUUID(),
        lines: [{ productId: p.id, unit: "CARTON", quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await balance(db, p.id, van.id)).toBe(200);
    expect(await balance(db, p.id, main.id)).toBe(100);
  });

  it("a warehouse holding stock can't be deactivated", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    await addStock(db, owner, p.id, main.id, 1);
    await expect(
      saveWarehouse(db, owner, main.id, { code: "MAIN", name: "Main store", status: "INACTIVE" }),
    ).rejects.toThrow(/still holds stock/);
  });
});

describe("stock counts", () => {
  it("storekeeper counts, owner posts; balances become the counted figures", async () => {
    const owner = await makeUser(db, "OWNER");
    const store = await makeUser(db, "STOREKEEPER");
    const a = await makeProduct(db, owner);
    const b = await makeProduct(db, owner);
    const c = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    await addStock(db, owner, a.id, main.id, 1000);
    await addStock(db, owner, b.id, main.id, 50);

    const count = await startCount(db, store, { warehouseId: main.id });
    expect(count.number).toBe("CNT-000001");
    await expect(startCount(db, store, { warehouseId: main.id })).rejects.toThrow(/still open/);

    const saved = await saveCount(db, store, count.id, {
      version: count.version,
      lines: [
        { productId: a.id, cartons: 4, packs: 9, pieces: 5 }, // 800 + 90 + 5 = 895 (105 missing)
        { productId: b.id, cartons: "", packs: "", pieces: "" }, // not counted: left alone
        { productId: c.id, cartons: 0, packs: 0, pieces: 7 }, // 7 found
      ],
    });
    await expect(postCount(db, store, count.id, saved.version)).rejects.toBeInstanceOf(ForbiddenError);

    // A sale-like movement happens between counting and posting: variance uses the balance at posting time.
    await postAdjustment(db, owner, {
      warehouseId: main.id,
      reason: "DAMAGED",
      idempotencyKey: randomUUID(),
      lines: [{ productId: a.id, direction: "OUT", unit: "PIECE", quantity: 5 }],
    });

    const result = await postCount(db, owner, count.id, saved.version);
    expect(result).toEqual({ number: "CNT-000001", counted: 2, changed: 2 });
    expect(await balance(db, a.id, main.id)).toBe(895);
    expect(await balance(db, b.id, main.id)).toBe(50);
    expect(await balance(db, c.id, main.id)).toBe(7);
    const loss = await db.stockMovement.findFirstOrThrow({ where: { productId: a.id, type: "COUNT_LOSS" } });
    expect(loss.quantity).toBe(-100); // 995 at posting → 895 counted

    await expect(postCount(db, owner, count.id, saved.version + 1)).rejects.toThrow(/already posted/);
    await expect(cancelCount(db, store, count.id)).rejects.toThrow(/Only an open count/);
  });

  it("a stale form can't overwrite someone else's figures", async () => {
    const owner = await makeUser(db, "OWNER");
    const p = await makeProduct(db, owner);
    const main = await mainWarehouse(db);
    const count = await startCount(db, owner, { warehouseId: main.id });
    await saveCount(db, owner, count.id, { version: 1, lines: [{ productId: p.id, pieces: 3 }] });
    await expect(
      saveCount(db, owner, count.id, { version: 1, lines: [{ productId: p.id, pieces: 9 }] }),
    ).rejects.toThrow(/Someone else saved/);
  });
});

describe("stock levels", () => {
  it("flags products at or below their reorder level", async () => {
    const owner = await makeUser(db, "OWNER");
    const ok = await makeProduct(db, owner, { reorderLevel: 10 });
    const low = await makeProduct(db, owner, { reorderLevel: 100 });
    const main = await mainWarehouse(db);
    await addStock(db, owner, ok.id, main.id, 50);
    await addStock(db, owner, low.id, main.id, 50);
    const { rows } = await stockLevels(db, owner, { lowOnly: true });
    expect(rows.map((r) => r.id)).toEqual([low.id]);
  });
});
