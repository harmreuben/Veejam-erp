import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addDays, todayInNairobi } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { postManualJournal, startAccounting, trialBalance } from "@/server/modules/accounting/service";
import { createCustomer } from "@/server/modules/customers/service";
import { postAdjustment } from "@/server/modules/inventory/documents";
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  markOrdered,
  updatePurchaseOrder,
} from "@/server/modules/purchasing/orders";
import {
  agedPayables,
  cancelSupplierBill,
  postSupplierBill,
  recordSupplierPayment,
  reverseSupplierPayment,
  supplierBalance,
  supplierStatement,
} from "@/server/modules/purchasing/payables";
import { getGoodsReceipt, postGoodsReceipt } from "@/server/modules/purchasing/receipts";
import { revalueStock } from "@/server/modules/purchasing/valuation";
import { stockValuation } from "@/server/modules/reports/service";
import { createCreditNote, creditableLines } from "@/server/modules/sales/credit-notes";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { createSupplier } from "@/server/modules/suppliers/service";
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

const today = () => todayInNairobi();

// Test product: 10 pieces a pack, 20 packs a carton → 200 pieces a carton.
async function setup() {
  const owner = await makeUser(db, "OWNER");
  const accountant = await makeUser(db, "ACCOUNTANT");
  const storekeeper = await makeUser(db, "STOREKEEPER");
  const sales = await makeUser(db, "SALES");
  const product = await makeProduct(db, owner, { prices: { PACK: "100", CARTON: "3000" } });
  const main = await mainWarehouse(db);
  const supplier = await createSupplier(db, owner, {
    name: `Supplier ${randomUUID().slice(0, 6)}`,
    paymentTermsDays: 30,
  });
  const customer = await createCustomer(db, owner, {
    name: `Customer ${randomUUID().slice(0, 6)}`,
    type: "WHOLESALER",
    creditLimit: "1000000",
  });
  return { owner, accountant, storekeeper, sales, product, main, supplier, customer };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const receive = (s: Setup, cartons: number, costPerCarton: string, extra: Record<string, unknown> = {}) =>
  postGoodsReceipt(db, s.owner, {
    supplierId: s.supplier.id,
    warehouseId: s.main.id,
    receivedOn: today(),
    idempotencyKey: randomUUID(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons, unitCost: costPerCarton }],
    ...extra,
  });

async function sell(s: Setup, cartons: number) {
  const { id } = await createDraft(db, s.owner, "INVOICE", {
    customerId: s.customer.id,
    warehouseId: s.main.id,
    issueDate: today(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons }],
  });
  await postInvoice(db, s.owner, id, { version: 1 });
  return db.salesDocument.findUniqueOrThrow({ where: { id } });
}

/** Expect a ValidationError whose message for one field matches. */
async function rejectsField(promise: Promise<unknown>, field: string, pattern: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  expect((error as ValidationError).fieldErrors[field]?.join(" ")).toMatch(pattern);
}

async function accountBalance(s: Setup, key: string) {
  const tb = await trialBalance(db, s.owner);
  expect(tb.balanced).toBe(true);
  return tb.rows.find((r) => r.systemKey === key)!.balance;
}

async function valuation(productId: string) {
  const v = await db.inventoryValuation.findUniqueOrThrow({ where: { productId } });
  return { quantity: v.quantity, value: v.value.toFixed(2) };
}

/** The Inventory account always equals the stock value; GRNI equals goods not yet billed; AP equals what's owed. */
async function expectLedgersAgree(s: Setup) {
  const stock = await rawQuery<{ v: string }>(
    "SELECT COALESCE(SUM(value),0)::text AS v FROM inventory_valuations",
  );
  expect(await accountBalance(s, "INVENTORY")).toBe(toDecimal(stock[0]!.v).toFixed(2));
  const unbilled = await rawQuery<{ v: string }>(
    "SELECT COALESCE(SUM(total_cost),0)::text AS v FROM goods_receipts WHERE bill_id IS NULL",
  );
  expect(await accountBalance(s, "GRNI")).toBe(toDecimal(unbilled[0]!.v).toFixed(2));
  const owed = await supplierBalance(db, s.supplier.id);
  expect(await accountBalance(s, "AP")).toBe(owed.balance);
}

describe("weighted-average costing", () => {
  it("receipts set the average; sales take cost of goods sold at it; returns come back at the sale's cost", async () => {
    const s = await setup();
    await receive(s, 10, "2000"); // 2,000 pieces at 10.00
    expect(await valuation(s.product.id)).toEqual({ quantity: 2000, value: "20000.00" });
    await receive(s, 10, "2600"); // 2,000 more at 13.00 → average 11.50
    expect(await valuation(s.product.id)).toEqual({ quantity: 4000, value: "46000.00" });
    // The last cost per piece becomes the product's cost price.
    expect((await db.product.findUniqueOrThrow({ where: { id: s.product.id } })).costPrice!.toFixed(2)).toBe(
      "13.00",
    );

    const inv = await sell(s, 3); // 600 pieces at 11.50 = 6,900
    const sale = await db.stockMovement.findFirstOrThrow({ where: { sourceId: inv.id } });
    expect(sale.costValue!.toFixed(2)).toBe("-6900.00");
    expect(await valuation(s.product.id)).toEqual({ quantity: 3400, value: "39100.00" });
    expect(await accountBalance(s, "COGS")).toBe("6900.00");

    // A newer, dearer receipt changes the average, but a return comes back at what it was sold at.
    await receive(s, 1, "4000");
    const lines = await creditableLines(db, s.owner, inv.id);
    await createCreditNote(db, s.owner, inv.id, {
      idempotencyKey: randomUUID(),
      reason: "Returned",
      returnsToStock: true,
      lines: [{ lineId: lines.lines[0]!.id, quantity: 1 }],
    });
    const back = await db.stockMovement.findFirstOrThrow({ where: { type: "RETURN_IN" } });
    expect(back.costValue!.toFixed(2)).toBe("2300.00"); // 200 pieces × 11.50
    expect(await accountBalance(s, "COGS")).toBe("4600.00");
    await expectLedgersAgree(s);
  });

  it("selling the last pieces takes all the remaining value, so nothing is left from rounding", async () => {
    const s = await setup();
    await postGoodsReceipt(db, s.owner, {
      supplierId: s.supplier.id,
      warehouseId: s.main.id,
      receivedOn: today(),
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, unit: "PIECE", quantity: 3, unitCost: "10.00" }],
    });
    await postAdjustment(db, s.owner, {
      warehouseId: s.main.id,
      reason: "DAMAGED",
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, direction: "OUT", unit: "PIECE", quantity: 1 }],
    });
    expect(await valuation(s.product.id)).toEqual({ quantity: 2, value: "20.00" });
    await postAdjustment(db, s.owner, {
      warehouseId: s.main.id,
      reason: "LOST_OR_STOLEN",
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, direction: "OUT", unit: "PIECE", quantity: 2 }],
    });
    expect(await valuation(s.product.id)).toEqual({ quantity: 0, value: "0.00" });
    // Write-offs go to Stock gains and losses.
    expect(await accountBalance(s, "STOCK_ADJ")).toBe("30.00");
    await expectLedgersAgree(s);
  });

  it("sales and deliveries at the same moment keep stock, its value and the ledger in step", async () => {
    const s = await setup();
    await receive(s, 10, "2000");
    const drafts = await Promise.all(
      Array.from({ length: 6 }, () =>
        createDraft(db, s.owner, "INVOICE", {
          customerId: s.customer.id,
          warehouseId: s.main.id,
          issueDate: today(),
          lines: [{ productId: s.product.id, unit: "CARTON", quantity: 1 }],
        }),
      ),
    );
    await Promise.all([
      ...drafts.map((d) => postInvoice(db, s.owner, d.id, { version: 1 })),
      receive(s, 2, "2600"),
      receive(s, 3, "2300"),
    ]);
    const v = await valuation(s.product.id);
    expect(v.quantity).toBe(await balance(db, s.product.id, s.main.id));
    expect(v.quantity).toBe(1800);
    const moved = await rawQuery<{ v: string }>(
      "SELECT SUM(cost_value)::text AS v FROM stock_movements WHERE product_id = $1",
      [s.product.id],
    );
    expect(toDecimal(moved[0]!.v).toFixed(2)).toBe(v.value);
    await expectLedgersAgree(s);
  });

  it("transfers move stock without changing its value", async () => {
    const s = await setup();
    await receive(s, 2, "2000");
    const other = await db.warehouse.create({ data: { code: "VAN", name: "Van" } });
    const { postTransfer } = await import("@/server/modules/inventory/documents");
    await postTransfer(db, s.owner, {
      fromWarehouseId: s.main.id,
      toWarehouseId: other.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, unit: "CARTON", quantity: 1 }],
    });
    expect(await valuation(s.product.id)).toEqual({ quantity: 400, value: "4000.00" });
    expect(await balance(db, s.product.id, other.id)).toBe(200);
    await expectLedgersAgree(s);
  });
});

describe("opening stock without a cost", () => {
  it("is valued by the owner against opening balances; Start the books picks up stock valued before costing", async () => {
    const s = await setup();
    await addStock(db, s.owner, s.product.id, s.main.id, 1000); // old-system stock, no cost
    expect((await stockValuation(db, s.owner)).missing).toBe(1);

    await expect(
      revalueStock(db, s.accountant, { productId: s.product.id, costPerPiece: "9.5", reason: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const r = await revalueStock(db, s.owner, {
      productId: s.product.id,
      costPerPiece: "9.5",
      againstOpening: "on",
      reason: "Mars price list October 2026",
    });
    expect(r.value).toBe("9500.00");
    expect(await accountBalance(s, "OPENING")).toBe("9500.00");
    expect((await stockValuation(db, s.owner)).missing).toBe(0);
    await expect(
      revalueStock(db, s.owner, { productId: s.product.id, costPerPiece: "9.50", reason: "again" }),
    ).rejects.toBeInstanceOf(ConflictError);

    // Stock valued before this phase (the migration sets value from cost prices) isn't in the books yet.
    const other = await makeProduct(db, s.owner);
    await addStock(db, s.owner, other.id, s.main.id, 100);
    await rawQuery("UPDATE inventory_valuations SET value = 450 WHERE product_id = $1", [other.id]);
    const res = await startAccounting(db, s.owner);
    expect(res.stockValue).toBe("450.00");
    await expectLedgersAgree(s);
    expect((await startAccounting(db, s.owner)).stockValue).toBeNull();
  });
});

describe("purchase orders and goods received", () => {
  it("draft → ordered → partly received → received; over-receiving refused; the database keeps lines in step", async () => {
    const s = await setup();
    const po = await createPurchaseOrder(db, s.accountant, {
      supplierId: s.supplier.id,
      warehouseId: s.main.id,
      orderDate: today(),
      lines: [{ productId: s.product.id, unit: "CARTON", quantity: 5, unitCost: "2000" }],
    });
    let view = await getPurchaseOrder(db, s.owner, po.id);
    expect(view.total).toBe("11600.00"); // 10,000 + 16% VAT
    await updatePurchaseOrder(db, s.accountant, po.id, {
      supplierId: s.supplier.id,
      warehouseId: s.main.id,
      orderDate: today(),
      version: 1,
      lines: [{ productId: s.product.id, unit: "CARTON", quantity: 4, unitCost: "2100" }],
    });
    await expect(
      postGoodsReceipt(db, s.owner, {
        supplierId: s.supplier.id,
        warehouseId: s.main.id,
        purchaseOrderId: po.id,
        receivedOn: today(),
        idempotencyKey: randomUUID(),
        lines: [],
      }),
    ).rejects.toThrow(/hasn't been sent/);
    await markOrdered(db, s.accountant, po.id, 2);
    view = await getPurchaseOrder(db, s.owner, po.id);
    const line = view.lines[0]!;

    // The storekeeper receives 3 of 4 cartons; costs come from the order.
    const grn = await postGoodsReceipt(db, s.storekeeper, {
      supplierId: s.supplier.id,
      warehouseId: s.main.id,
      purchaseOrderId: po.id,
      receivedOn: today(),
      supplierReference: "DN 7781",
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, orderLineId: line.id, unit: "CARTON", quantity: 3, unitCost: "1" }],
    });
    const g = await getGoodsReceipt(db, s.owner, grn.id);
    expect(g.totalCost).toBe("6300.00");
    expect((await getGoodsReceipt(db, s.storekeeper, grn.id)).totalCost).toBeNull(); // no costs for storekeepers
    expect((await getPurchaseOrder(db, s.owner, po.id)).status).toBe("PARTLY_RECEIVED");
    await expect(cancelPurchaseOrder(db, s.accountant, po.id, { reason: "x", version: 4 })).rejects.toThrow(
      /Close it instead/,
    );

    await expect(
      postGoodsReceipt(db, s.owner, {
        supplierId: s.supplier.id,
        warehouseId: s.main.id,
        purchaseOrderId: po.id,
        receivedOn: today(),
        idempotencyKey: randomUUID(),
        lines: [{ productId: s.product.id, orderLineId: line.id, unit: "CARTON", quantity: 2 }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await postGoodsReceipt(db, s.owner, {
      supplierId: s.supplier.id,
      warehouseId: s.main.id,
      purchaseOrderId: po.id,
      receivedOn: today(),
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, orderLineId: line.id, unit: "CARTON", quantity: 1 }],
    });
    expect((await getPurchaseOrder(db, s.owner, po.id)).status).toBe("RECEIVED");
    expect(await balance(db, s.product.id, s.main.id)).toBe(800);
    await expect(
      rawQuery("UPDATE purchase_order_lines SET received_pieces = pieces + 1 WHERE id = $1", [line.id]),
    ).rejects.toThrow();
    await expect(
      rawQuery("UPDATE goods_receipts SET total_cost = 1 WHERE id = $1", [grn.id]),
    ).rejects.toThrow(/can't be edited/);
    await expectLedgersAgree(s);
  });

  it("storekeepers can only receive against an order; sales can't receive; the same form twice posts once", async () => {
    const s = await setup();
    await expect(receive({ ...s, owner: s.storekeeper }, 1, "2000")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(receive({ ...s, owner: s.sales }, 1, "2000")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createPurchaseOrder(db, s.storekeeper, {
        supplierId: s.supplier.id,
        warehouseId: s.main.id,
        orderDate: today(),
        lines: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      receive(s, 1, "2000", { idempotencyKey: key }),
      receive(s, 1, "2000", { idempotencyKey: key }),
    ]);
    expect(a.number).toBe(b.number);
    expect(await balance(db, s.product.id, s.main.id)).toBe(200);
  });

  it("an order with nothing received can be cancelled; a partly received one closed", async () => {
    const s = await setup();
    const make = () =>
      createPurchaseOrder(db, s.owner, {
        supplierId: s.supplier.id,
        warehouseId: s.main.id,
        orderDate: today(),
        lines: [{ productId: s.product.id, unit: "CARTON", quantity: 2, unitCost: "2000" }],
      });
    const a = await make();
    await cancelPurchaseOrder(db, s.owner, a.id, { reason: "Ordered by phone instead", version: 1 });
    const b = await make();
    await markOrdered(db, s.owner, b.id, 1);
    const line = (await getPurchaseOrder(db, s.owner, b.id)).lines[0]!;
    await postGoodsReceipt(db, s.owner, {
      supplierId: s.supplier.id,
      warehouseId: s.main.id,
      purchaseOrderId: b.id,
      receivedOn: today(),
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, orderLineId: line.id, unit: "CARTON", quantity: 1 }],
    });
    await closePurchaseOrder(db, s.owner, b.id, { reason: "Supplier out of stock", version: 3 });
    expect((await getPurchaseOrder(db, s.owner, b.id)).status).toBe("CLOSED");
  });
});

describe("supplier bills", () => {
  it("clears goods received, books VAT and the price difference, and refuses duplicates", async () => {
    const s = await setup();
    const grn = await receive(s, 5, "2000"); // 10,000 at cost
    const bill = await postSupplierBill(db, s.accountant, {
      supplierId: s.supplier.id,
      supplierInvoiceNumber: "inv-5501",
      billDate: today(),
      idempotencyKey: randomUUID(),
      receipts: [{ goodsReceiptId: grn.id, include: "on", net: "10050", tax: "1608" }],
      expenses: [
        {
          accountId: (await db.account.findFirstOrThrow({ where: { code: "6200" } })).id,
          description: "Delivery",
          net: "500",
          tax: "80",
        },
      ],
    });
    const b = await db.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(b.total.toFixed(2)).toBe("12238.00");
    expect(b.supplierInvoiceNumber).toBe("INV-5501");
    expect(b.dueDate.toISOString().slice(0, 10)).toBe(addDays(today(), 30));
    expect(await accountBalance(s, "GRNI")).toBe("0.00");
    expect(await accountBalance(s, "PRICE_DIFF")).toBe("50.00");
    expect(await accountBalance(s, "VAT_INPUT")).toBe("1688.00");
    expect(await accountBalance(s, "AP")).toBe("12238.00");
    await expectLedgersAgree(s);

    const grn2 = await receive(s, 1, "2000");
    await rejectsField(
      postSupplierBill(db, s.accountant, {
        supplierId: s.supplier.id,
        supplierInvoiceNumber: "INV-5501",
        billDate: today(),
        idempotencyKey: randomUUID(),
        receipts: [{ goodsReceiptId: grn2.id, include: "on", net: "2000", tax: "320" }],
      }),
      "supplierInvoiceNumber",
      /already entered as BILL-/,
    );
    await expect(
      postSupplierBill(db, s.accountant, {
        supplierId: s.supplier.id,
        supplierInvoiceNumber: "INV-5502",
        billDate: today(),
        idempotencyKey: randomUUID(),
        receipts: [{ goodsReceiptId: grn.id, include: "on", net: "10000", tax: "1600" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(rawQuery("UPDATE supplier_bills SET total = 1 WHERE id = $1", [bill.id])).rejects.toThrow(
      /can't be edited/,
    );
    await expect(rawQuery("DELETE FROM supplier_bill_lines WHERE bill_id = $1", [bill.id])).rejects.toThrow();
    await expect(
      postSupplierBill(db, s.storekeeper, {
        supplierId: s.supplier.id,
        supplierInvoiceNumber: "X",
        billDate: today(),
        idempotencyKey: randomUUID(),
        receipts: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("cancelling a bill reverses it, frees its goods received and returns any payment as credit", async () => {
    const s = await setup();
    const grn = await receive(s, 1, "2000");
    const bill = await postSupplierBill(db, s.accountant, {
      supplierId: s.supplier.id,
      supplierInvoiceNumber: "A1",
      billDate: today(),
      idempotencyKey: randomUUID(),
      receipts: [{ goodsReceiptId: grn.id, include: true, net: "2000", tax: "320" }],
    });
    await recordSupplierPayment(db, s.accountant, {
      supplierId: s.supplier.id,
      paidOn: today(),
      method: "BANK_TRANSFER",
      amount: "1000",
      idempotencyKey: randomUUID(),
    });
    await cancelSupplierBill(db, s.accountant, bill.id, { version: 1, reason: "Wrong supplier" });
    expect((await db.goodsReceipt.findUniqueOrThrow({ where: { id: grn.id } })).billId).toBeNull();
    const bal = await supplierBalance(db, s.supplier.id);
    expect(bal).toMatchObject({ owedOnBills: "0.00", paidInAdvance: "1000.00", balance: "-1000.00" });
    await expectLedgersAgree(s);

    // The goods can be billed again; the money paid earlier is applied straight away.
    const again = await postSupplierBill(db, s.accountant, {
      supplierId: s.supplier.id,
      supplierInvoiceNumber: "A1",
      billDate: today(),
      idempotencyKey: randomUUID(),
      receipts: [{ goodsReceiptId: grn.id, include: true, net: "2000", tax: "320" }],
    });
    expect(again.creditApplied).toBe("1000.00");
    expect(await supplierBalance(db, s.supplier.id)).toMatchObject({
      balance: "1320.00",
      paidInAdvance: "0.00",
    });
    await expectLedgersAgree(s);
  });
});

describe("paying suppliers", () => {
  it("pays the oldest bills first, keeps the rest as credit, reverses cleanly, and ages what's owed", async () => {
    const s = await setup();
    const bill = async (n: string, cartons: number, date = today()) => {
      const grn = await receive(s, cartons, "1000");
      return postSupplierBill(db, s.accountant, {
        supplierId: s.supplier.id,
        supplierInvoiceNumber: n,
        billDate: date,
        dueDate: date,
        idempotencyKey: randomUUID(),
        receipts: [{ goodsReceiptId: grn.id, include: true, net: String(cartons * 1000), tax: "0" }],
      });
    };
    const old = await bill("OLD", 2, addDays(today(), -45));
    const recent = await bill("NEW", 3);
    const aged = await agedPayables(db, s.accountant);
    expect(aged.rows[0]).toMatchObject({ current: "3000.00", d60: "2000.00", total: "5000.00" });

    const pay = await recordSupplierPayment(db, s.accountant, {
      supplierId: s.supplier.id,
      paidOn: today(),
      method: "MPESA",
      reference: "ABC123XYZ9",
      amount: "6000",
      idempotencyKey: randomUUID(),
    });
    expect(pay).toMatchObject({ applied: "5000.00", credit: "1000.00" });
    for (const id of [old.id, recent.id]) {
      const b = await db.supplierBill.findUniqueOrThrow({ where: { id } });
      expect(b.amountPaid.equals(b.total)).toBe(true);
    }
    expect(await accountBalance(s, "MPESA")).toBe("-6000.00");
    await expectLedgersAgree(s);
    await rejectsField(
      recordSupplierPayment(db, s.accountant, {
        supplierId: s.supplier.id,
        paidOn: today(),
        method: "MPESA",
        reference: "ABC123XYZ9",
        amount: "10",
        idempotencyKey: randomUUID(),
      }),
      "reference",
      /already recorded on SPAY-/,
    );
    await expect(
      recordSupplierPayment(db, s.sales, {
        supplierId: s.supplier.id,
        paidOn: today(),
        method: "CASH",
        amount: "10",
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const statement = await supplierStatement(db, s.accountant, s.supplier.id);
    expect(statement.balance).toBe("-1000.00");

    await reverseSupplierPayment(db, s.accountant, pay.id, { version: 1, reason: "Sent to the wrong till" });
    expect(await supplierBalance(db, s.supplier.id)).toMatchObject({ balance: "5000.00" });
    expect(await accountBalance(s, "MPESA")).toBe("0.00");
    await expectLedgersAgree(s);
  });

  it("manual allocation can't exceed what a bill owes or what was paid", async () => {
    const s = await setup();
    const grn = await receive(s, 1, "1000");
    const b = await postSupplierBill(db, s.accountant, {
      supplierId: s.supplier.id,
      supplierInvoiceNumber: "M1",
      billDate: today(),
      idempotencyKey: randomUUID(),
      receipts: [{ goodsReceiptId: grn.id, include: true, net: "1000", tax: "0" }],
    });
    const base = { supplierId: s.supplier.id, paidOn: today(), method: "CASH", allocate: "manual" };
    await expect(
      recordSupplierPayment(db, s.accountant, {
        ...base,
        amount: "5000",
        idempotencyKey: randomUUID(),
        allocations: [{ billId: b.id, amount: "1500" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordSupplierPayment(db, s.accountant, {
        ...base,
        amount: "500",
        idempotencyKey: randomUUID(),
        allocations: [{ billId: b.id, amount: "800" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the ledger stays in step", () => {
  it("manual journals can't touch stock, payables or goods awaiting a bill", async () => {
    const s = await setup();
    for (const code of ["1200", "2000", "2050"]) {
      const acc = await db.account.findFirstOrThrow({ where: { code } });
      const cash = await db.account.findFirstOrThrow({ where: { code: "1000" } });
      await expect(
        postManualJournal(db, s.owner, {
          date: today(),
          description: "Try",
          lines: [
            { accountId: acc.id, debit: "10" },
            { accountId: cash.id, credit: "10" },
          ],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });
});
