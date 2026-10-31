import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { fromDbDate } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { SELL_UNITS } from "@/lib/units";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/errors";
import { isUniqueViolation } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { isUuid, moneyField, optionalText, parseInput, requiredText } from "@/server/shared/validation";

import { paySupplierTx, postBillTx } from "./payables";
import { receiveGoodsTx } from "./receipts";

/*
 * A stock purchase: what VeeJam bought from a supplier, in one step.
 * It replaces purchase orders, goods received and supplier bills (removed
 * Oct 2026), and reuses their tested postings inside one transaction:
 *   1. the goods come into stock at cost (Dr Inventory, Cr Goods received not billed);
 *   2. the supplier's invoice is entered against them (Dr Goods received not
 *      billed + VAT recoverable if VAT-registered, Cr Payables);
 *   3. if it was paid now, the payment (Dr Payables, Cr Cash / M-Pesa / Bank).
 * The stock is never an expense: its cost reaches profit only as COGS when sold.
 * Sending the same form twice records it once.
 */

export { PAID_FROM, PAID_FROM_LABELS, type PaidFrom } from "./stock-purchase-labels";
import { PAID_FROM, type PaidFrom } from "./stock-purchase-labels";

const METHOD: Record<Exclude<PaidFrom, "CREDIT">, "CASH" | "MPESA" | "BANK_TRANSFER"> = {
  CASH: "CASH",
  MPESA: "MPESA",
  BANK: "BANK_TRANSFER",
};

const day = z.string({ error: "Enter the date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

export const stockPurchaseSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== "object") return v;
    const o = v as { lines?: unknown };
    if (!Array.isArray(o.lines)) return v;
    return {
      ...o,
      lines: o.lines.filter((l) => l && typeof l === "object" && (l as { productId?: string }).productId),
    };
  },
  z
    .object({
      supplierId: z.uuid("Choose a supplier"),
      warehouseId: z.uuid("Choose the warehouse"),
      purchasedOn: day,
      supplierInvoiceNumber: requiredText(
        60,
        "Enter the number on the supplier's invoice or receipt",
      ).transform((s) => s.toUpperCase()),
      paidFrom: z.enum(PAID_FROM, { error: "Say whether it was paid, and from which account" }),
      reference: optionalText(40),
      notes: optionalText(2000),
      idempotencyKey: z.uuid(),
      lines: z
        .array(
          z.object({
            productId: z.uuid("Choose a product"),
            unit: z.enum(SELL_UNITS),
            quantity: z.coerce
              .number({ error: "Enter a quantity" })
              .int("Whole numbers only")
              .min(1, "At least 1")
              .max(1_000_000),
            unitCost: moneyField({ min: "0", label: "the cost per unit" }),
          }),
        )
        .max(200),
    })
    .superRefine((v, c) => {
      if (v.paidFrom === "MPESA" && (!v.reference || !/^[A-Z0-9]{10}$/i.test(v.reference))) {
        c.addIssue({ code: "custom", path: ["reference"], message: "Enter the 10-character M-Pesa code" });
      }
    }),
);

export type StockPurchaseResult = {
  id: string;
  number: string;
  billNumber: string;
  paymentNumber: string | null;
  total: string;
  alreadyRecorded: boolean;
};

export async function recordStockPurchase(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<StockPurchaseResult> {
  authorize(actor, "goods.receive");
  authorize(actor, "bills.manage");
  authorize(actor, "catalogue.costs");
  const v = parseInput(stockPurchaseSchema, input);
  if (v.paidFrom !== "CREDIT") authorize(actor, "supplier_payments.manage");
  if (!v.lines.length) throw new ValidationError({ lines: ["Add at least one product"] });

  const done = async () => {
    const grn = await db.goodsReceipt.findUnique({ where: { idempotencyKey: v.idempotencyKey } });
    return grn ? summary(db, grn.id, true) : null;
  };
  const earlier = await done();
  if (earlier) return earlier;

  try {
    const id = await db.$transaction(
      async (tx) => {
        const grn = await receiveGoodsTx(
          tx,
          actor,
          {
            supplierId: v.supplierId,
            warehouseId: v.warehouseId,
            purchaseOrderId: null,
            receivedOn: v.purchasedOn,
            supplierReference: v.supplierInvoiceNumber,
            notes: v.notes,
            idempotencyKey: v.idempotencyKey,
            lines: v.lines.map((l) => ({ ...l, orderLineId: null })),
          },
          ctx,
        );
        const received = await tx.goodsReceipt.findUniqueOrThrow({ where: { id: grn.id } });
        const settings = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
        // VAT on the purchase is recoverable only when VeeJam is VAT-registered;
        // otherwise the cost entered is the full cost of the stock.
        const tax = settings.vatRegistered ? received.expectedTax.toFixed(2) : "0.00";
        await postBillTx(
          tx,
          actor,
          {
            supplierId: v.supplierId,
            supplierInvoiceNumber: v.supplierInvoiceNumber,
            billDate: v.purchasedOn,
            dueDate: v.paidFrom === "CREDIT" ? null : v.purchasedOn,
            notes: v.notes,
            idempotencyKey: randomUUID(),
            receipts: [
              { goodsReceiptId: received.id, include: true, net: received.totalCost.toFixed(2), tax },
            ],
            expenses: [],
          },
          ctx,
        );
        if (v.paidFrom !== "CREDIT") {
          const total = received.totalCost.plus(tax);
          if (total.greaterThan(0)) {
            await paySupplierTx(
              tx,
              actor,
              {
                supplierId: v.supplierId,
                paidOn: v.purchasedOn,
                method: METHOD[v.paidFrom],
                reference: v.reference ? v.reference.toUpperCase() : null,
                amount: total.toFixed(2),
                notes: `For ${grn.number} (${v.supplierInvoiceNumber})`,
                idempotencyKey: randomUUID(),
                allocate: "manual",
                allocations: [
                  {
                    billId: (await tx.goodsReceipt.findUniqueOrThrow({ where: { id: grn.id } })).billId!,
                    amount: total.toFixed(2),
                  },
                ],
              },
              ctx,
            );
          }
        }
        return grn.id;
      },
      { maxWait: 15_000, timeout: 60_000 },
    );
    return summary(db, id, false);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await done();
      if (winner) return winner;
    }
    throw error;
  }
}

async function summary(db: Db, id: string, alreadyRecorded: boolean): Promise<StockPurchaseResult> {
  const p = await getStockPurchaseRow(db, id);
  return {
    id,
    number: p.number,
    billNumber: p.bill?.number ?? "",
    paymentNumber: p.payments[0]?.number ?? null,
    total: p.total,
    alreadyRecorded,
  };
}

async function getStockPurchaseRow(db: Db, id: string) {
  const g = await db.goodsReceipt.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      warehouse: { select: { name: true } },
      postedBy: { select: { fullName: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, unitsPerPack: true, packsPerCarton: true } },
        },
      },
      bill: {
        include: {
          allocations: {
            where: { payment: { status: "POSTED" } },
            include: {
              payment: { select: { id: true, number: true, method: true, reference: true, paidOn: true } },
            },
          },
        },
      },
    },
  });
  if (!g) throw new NotFoundError();
  const total = g.bill ? g.bill.total : g.totalCost;
  const paid = g.bill ? g.bill.amountPaid : toDecimal(0);
  return {
    id: g.id,
    number: g.number,
    date: fromDbDate(g.receivedOn),
    supplier: g.supplier,
    warehouse: g.warehouse.name,
    supplierReference: g.supplierReference,
    notes: g.notes,
    postedBy: g.postedBy.fullName,
    postedAt: g.postedAt,
    lines: g.lines.map((l) => ({
      id: l.id,
      product: l.product,
      unit: l.unit,
      quantity: l.quantity,
      pieces: l.pieces,
      unitCost: l.unitCost.toFixed(2),
      lineCost: l.lineCost.toFixed(2),
    })),
    cost: g.totalCost.toFixed(2),
    tax: g.bill ? g.bill.taxTotal.toFixed(2) : "0.00",
    total: total.toFixed(2),
    paid: paid.toFixed(2),
    owed: total.minus(paid).toFixed(2),
    bill: g.bill ? { id: g.bill.id, number: g.bill.number, status: g.bill.status } : null,
    payments: (g.bill?.allocations ?? []).map((a) => ({
      id: a.payment.id,
      number: a.payment.number,
      method: a.payment.method,
      reference: a.payment.reference,
      date: fromDbDate(a.payment.paidOn),
      amount: a.amount.toFixed(2),
    })),
  };
}

/** One stock purchase with its lines, bill and payments. */
export async function getStockPurchase(db: Db, actor: Actor, id: string) {
  authorize(actor, "purchasing.view");
  if (!isUuid(id)) throw new NotFoundError();
  return getStockPurchaseRow(db, id);
}

/** Stock purchases, newest first, with what's still owed on each. */
export async function listStockPurchases(db: Db, actor: Actor, filter: { q?: string } = {}) {
  authorize(actor, "purchasing.view");
  const q = filter.q?.trim();
  const rows = await db.goodsReceipt.findMany({
    where: q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { supplierReference: { contains: q, mode: "insensitive" } },
            { supplier: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {},
    orderBy: [{ receivedOn: "desc" }, { number: "desc" }],
    take: 200,
    include: {
      supplier: { select: { id: true, name: true } },
      bill: { select: { number: true, total: true, amountPaid: true, status: true } },
      _count: { select: { lines: true } },
    },
  });
  return rows.map((g) => {
    const total = g.bill && g.bill.status === "POSTED" ? g.bill.total : g.totalCost;
    const paid = g.bill && g.bill.status === "POSTED" ? g.bill.amountPaid : toDecimal(0);
    return {
      id: g.id,
      number: g.number,
      date: fromDbDate(g.receivedOn),
      supplier: g.supplier,
      supplierReference: g.supplierReference,
      lines: g._count.lines,
      total: total.toFixed(2),
      owed: total.minus(paid).toFixed(2),
      billed: !!g.bill && g.bill.status === "POSTED",
    };
  });
}

export const describePurchase = (r: StockPurchaseResult) =>
  `${r.number} recorded: ${formatKES(r.total)}` +
  (r.paymentNumber ? `, paid (${r.paymentNumber})` : ", owed to the supplier");

/** Suppliers, warehouses and products (with their latest cost) for the purchase form. */
export async function stockPurchaseFormData(db: Db, actor: Actor) {
  authorize(actor, "goods.receive");
  authorize(actor, "catalogue.costs");
  const [suppliers, warehouses, products, settings] = await Promise.all([
    db.supplier.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.warehouse.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, unitsPerPack: true, packsPerCarton: true, costPrice: true },
    }),
    db.companySettings.findUniqueOrThrow({ where: { id: 1 }, select: { vatRegistered: true } }),
  ]);
  return {
    suppliers,
    warehouses,
    vatRegistered: settings.vatRegistered,
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unitsPerPack: p.unitsPerPack,
      packsPerCarton: p.packsPerCarton,
      costPerPiece: p.costPrice?.toFixed(2) ?? null,
    })),
  };
}
