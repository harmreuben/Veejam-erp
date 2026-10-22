import { z } from "zod";

import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { SELL_UNITS } from "@/lib/units";
import { moneyField, optionalText, requiredText, versionField } from "@/server/shared/validation";

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTLY_RECEIVED: "Partly received",
  RECEIVED: "Received",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const day = z
  .string({ error: "Enter the date" })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

const optionalDay = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date");

const qty = z.coerce
  .number({ error: "Enter a quantity" })
  .int("Use whole numbers; enter loose pieces with the Piece unit")
  .min(1, "At least 1")
  .max(1_000_000, "Too large");

/** Lines left blank in the form (no product) are dropped before validation. */
const dropBlankLines = (v: unknown) => {
  if (!v || typeof v !== "object") return v;
  const o = v as { lines?: unknown };
  if (!Array.isArray(o.lines)) return v;
  return {
    ...o,
    lines: o.lines.filter((l) => l && typeof l === "object" && (l as { productId?: string }).productId),
  };
};

export const purchaseOrderSchema = z.preprocess(
  dropBlankLines,
  z.object({
    supplierId: z.uuid("Choose a supplier"),
    warehouseId: z.uuid("Choose where the goods will be delivered"),
    orderDate: day,
    expectedDate: optionalDay,
    notes: optionalText(2000),
    version: versionField.optional(),
    lines: z
      .array(
        z.object({
          productId: z.uuid("Choose a product"),
          unit: z.enum(SELL_UNITS),
          quantity: qty,
          unitCost: moneyField({ min: "0", label: "the cost per unit" }),
        }),
      )
      .min(1, "Add at least one product")
      .max(200, "At most 200 lines"),
  }),
);

export const cancelSchema = z.object({
  reason: requiredText(500, "Say why"),
  version: versionField,
});

export const goodsReceiptSchema = z.preprocess(
  dropBlankLines,
  z.object({
    supplierId: z.uuid("Choose a supplier"),
    warehouseId: z.uuid("Choose the warehouse"),
    purchaseOrderId: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || z.uuid().safeParse(v).success, "Choose a purchase order"),
    receivedOn: day,
    supplierReference: optionalText(60),
    notes: optionalText(2000),
    idempotencyKey: z.uuid(),
    lines: z
      .array(
        z.object({
          productId: z.uuid("Choose a product"),
          orderLineId: z
            .string()
            .nullable()
            .optional()
            .transform((v) => (v ? v : null)),
          unit: z.enum(SELL_UNITS),
          quantity: z.coerce
            .number({ error: "Enter a quantity" })
            .int("Whole numbers only")
            .min(0, "Can't be negative")
            .max(1_000_000, "Too large"),
          /** Blank when the person can't see costs: the purchase order's cost is used. */
          unitCost: moneyField({ min: "0", allowBlank: true }),
        }),
      )
      .max(200, "At most 200 lines"),
  }),
);

export const billSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== "object") return v;
    const o = v as { expenses?: unknown; receipts?: unknown };
    return {
      ...o,
      receipts: Array.isArray(o.receipts)
        ? o.receipts.filter((r) => r && (r as { include?: unknown }).include)
        : [],
      expenses: Array.isArray(o.expenses)
        ? o.expenses.filter(
            (e) => e && ((e as { accountId?: string }).accountId || (e as { net?: string }).net),
          )
        : [],
    };
  },
  z.object({
    supplierId: z.uuid("Choose a supplier"),
    supplierInvoiceNumber: requiredText(60, "Enter the number on the supplier's invoice").transform((s) =>
      s.toUpperCase(),
    ),
    billDate: day,
    dueDate: optionalDay,
    notes: optionalText(2000),
    idempotencyKey: z.uuid(),
    receipts: z
      .array(
        z.object({
          goodsReceiptId: z.uuid(),
          include: z.unknown(),
          net: moneyField({ min: "0", label: "the amount excluding VAT" }),
          tax: moneyField({ min: "0", label: "the VAT" }),
        }),
      )
      .max(200),
    expenses: z
      .array(
        z.object({
          accountId: z.uuid("Choose an account"),
          description: requiredText(200, "Say what it was for"),
          net: moneyField({ min: "0.01", label: "the amount excluding VAT" }),
          tax: moneyField({ min: "0", allowBlank: true }),
        }),
      )
      .max(50),
  }),
);

export const supplierPaymentSchema = z
  .object({
    supplierId: z.uuid("Choose a supplier"),
    paidOn: day,
    method: z.enum(["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE"], { error: "Choose how you paid" }),
    reference: optionalText(40),
    amount: moneyField({ min: "0.01", label: "the amount paid" }),
    notes: optionalText(1000),
    idempotencyKey: z.uuid(),
    allocate: z.enum(["auto", "manual"]).default("auto"),
    allocations: z
      .array(z.object({ billId: z.uuid(), amount: moneyField({ allowBlank: true, min: "0" }) }))
      .max(500)
      .default([]),
  })
  .transform((v) => ({
    ...v,
    amount: v.amount as string,
    reference: v.reference ? v.reference.toUpperCase().replace(/\s+/g, "") : null,
    allocations: v.allocations.filter((a) => a.amount !== null && Number(a.amount) > 0) as {
      billId: string;
      amount: string;
    }[],
  }))
  .superRefine((v, ctx) => {
    if (v.method === "CHEQUE" && !v.reference) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the cheque number" });
    }
    if (v.method === "MPESA" && v.reference && !/^[A-Z0-9]{10}$/.test(v.reference)) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "An M-Pesa code is 10 letters and digits, e.g. SJK3H7QW2P",
      });
    }
  });

export const revalueSchema = z.object({
  productId: z.uuid(),
  costPerPiece: z
    .string({ error: "Enter the cost of one piece" })
    .trim()
    .transform((s) => s.replace(/,/g, ""))
    .refine((s) => /^\d+(\.\d{1,4})?$/.test(s), "Use digits with up to 4 decimal places, e.g. 4.8333"),
  againstOpening: z
    .unknown()
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  reason: requiredText(500, "Say where the cost comes from, e.g. Mars invoice 12345"),
});
