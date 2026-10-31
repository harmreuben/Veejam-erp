import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { ValidationError } from "@/server/errors";
import { trialBalance } from "@/server/modules/accounting/service";
import { createCustomer } from "@/server/modules/customers/service";
import { recordSupplierPayment, supplierBalance } from "@/server/modules/purchasing/payables";
import {
  getStockPurchase,
  listStockPurchases,
  recordStockPurchase,
} from "@/server/modules/purchasing/stock-purchase";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { createSupplier } from "@/server/modules/suppliers/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";
import { balance, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});
const today = () => todayInNairobi();

// 200 pieces a carton.
async function setup(vatRegistered = false) {
  const owner = await makeUser(db, "OWNER");
  await db.companySettings.update({ where: { id: 1 }, data: { vatRegistered } });
  const product = await makeProduct(db, owner, { prices: { CARTON: "3000" } });
  const main = await mainWarehouse(db);
  const supplier = await createSupplier(db, owner, {
    name: `Supplier ${randomUUID().slice(0, 6)}`,
    paymentTermsDays: 30,
  });
  return { owner, product, main, supplier };
}
type S = Awaited<ReturnType<typeof setup>>;

const buy = (s: S, extra: Record<string, unknown> = {}) =>
  recordStockPurchase(db, s.owner, {
    supplierId: s.supplier.id,
    warehouseId: s.main.id,
    purchasedOn: today(),
    supplierInvoiceNumber: `inv-${randomUUID().slice(0, 6)}`,
    paidFrom: "CASH",
    idempotencyKey: randomUUID(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: 5, unitCost: "2000" }],
    ...extra,
  });

async function accounts(s: S) {
  const tb = await trialBalance(db, s.owner);
  const by = (k: string) => tb.rows.find((r) => r.systemKey === k)?.balance ?? "0.00";
  return {
    balanced: tb.balanced,
    CASH: by("CASH"),
    MPESA: by("MPESA"),
    INV: by("INVENTORY"),
    AP: by("AP"),
    GRNI: by("GRNI"),
    VAT_IN: by("VAT_INPUT"),
    COGS: by("COGS"),
    profit: tb.profit,
  };
}

describe("stock purchase", () => {
  it("paid now: stock in at cost, money out of the chosen account, nothing owed, no expense", async () => {
    const s = await setup();
    const key = randomUUID();
    const r = await buy(s, { idempotencyKey: key });
    expect(r).toMatchObject({ number: "GRN-000001", total: "10000.00", alreadyRecorded: false });
    expect(r.paymentNumber).toBeTruthy();
    expect(await balance(db, s.product.id, s.main.id)).toBe(1000);
    expect(await accounts(s)).toMatchObject({
      balanced: true,
      CASH: "-10000.00",
      INV: "10000.00",
      AP: "0.00",
      GRNI: "0.00",
      profit: "0.00",
    });
    // The same form twice records once.
    expect(await buy(s, { idempotencyKey: key })).toMatchObject({ id: r.id, alreadyRecorded: true });
    expect(await balance(db, s.product.id, s.main.id)).toBe(1000);
    const p = await getStockPurchase(db, s.owner, r.id);
    expect(p).toMatchObject({ total: "10000.00", paid: "10000.00", owed: "0.00" });
    expect(p.payments[0]).toMatchObject({ method: "CASH", amount: "10000.00" });
  });

  it("on credit: owed to the supplier until a supplier payment settles it", async () => {
    const s = await setup();
    const r = await buy(s, { paidFrom: "CREDIT" });
    expect(r.paymentNumber).toBeNull();
    expect((await supplierBalance(db, s.supplier.id)).owedOnBills).toBe("10000.00");
    expect(await accounts(s)).toMatchObject({
      balanced: true,
      CASH: "0.00",
      AP: "10000.00",
      INV: "10000.00",
    });
    await recordSupplierPayment(db, s.owner, {
      supplierId: s.supplier.id,
      paidOn: today(),
      method: "MPESA",
      reference: "SJK3H7QW2P",
      amount: "10000",
      idempotencyKey: randomUUID(),
    });
    expect(await accounts(s)).toMatchObject({ AP: "0.00", MPESA: "-10000.00" });
    expect((await listStockPurchases(db, s.owner))[0]).toMatchObject({ owed: "0.00" });
  });

  it("VAT-registered: VAT is recoverable and paid on top; still no expense", async () => {
    const s = await setup(true);
    const r = await buy(s, { paidFrom: "BANK" });
    expect(r.total).toBe("11600.00");
    expect(await accounts(s)).toMatchObject({
      balanced: true,
      INV: "10000.00",
      VAT_IN: "1600.00",
      profit: "0.00",
    });
  });

  it("the cost reaches profit only as COGS when the stock is sold", async () => {
    const s = await setup();
    await buy(s);
    const customer = await createCustomer(db, s.owner, {
      name: "Shop",
      type: "WHOLESALER",
      creditLimit: "100000",
    });
    const { id } = await createDraft(db, s.owner, "INVOICE", {
      customerId: customer.id,
      warehouseId: s.main.id,
      issueDate: today(),
      lines: [{ productId: s.product.id, unit: "CARTON", quantity: 1 }],
    });
    await postInvoice(db, s.owner, id, { version: 1 });
    const a = await accounts(s);
    expect(a).toMatchObject({ COGS: "2000.00", INV: "8000.00", balanced: true });
  });

  it("refuses bad input and records nothing", async () => {
    const s = await setup();
    await expect(buy(s, { lines: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(buy(s, { paidFrom: "MPESA", reference: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(buy(s, { supplierInvoiceNumber: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.goodsReceipt.count()).toBe(0);
    expect(await db.supplierBill.count()).toBe(0);
  });
});
