import { z } from "zod";

import type { SalesDocumentKind, SalesDocumentStatus } from "@/generated/prisma/enums";
import { SELL_UNITS } from "@/lib/units";
import { optionalText, requiredText, versionField } from "@/server/shared/validation";

export const KIND_LABELS: Record<SalesDocumentKind, { one: string; many: string; path: string }> = {
  QUOTATION: { one: "Quotation", many: "Quotations", path: "/quotations" },
  SALES_ORDER: { one: "Sales order", many: "Sales orders", path: "/sales-orders" },
  INVOICE: { one: "Invoice", many: "Invoices", path: "/invoices" },
  CREDIT_NOTE: { one: "Credit note", many: "Credit notes", path: "/credit-notes" },
};

export const STATUS_LABELS: Record<SalesDocumentStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CONVERTED: "Converted",
  CONFIRMED: "Confirmed",
  INVOICED: "Invoiced",
  POSTED: "Posted",
  CANCELLED: "Cancelled",
};

/** Statuses in which the document's lines can still be edited. */
export const EDITABLE_STATUSES: Record<SalesDocumentKind, SalesDocumentStatus[]> = {
  QUOTATION: ["DRAFT", "SENT"],
  SALES_ORDER: ["DRAFT"],
  INVOICE: ["DRAFT"],
  CREDIT_NOTE: [],
};

/** A calendar date typed as YYYY-MM-DD (what <input type="date"> sends). */
export const dateField = (label: string) =>
  z
    .string({ error: `Enter ${label}` })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter ${label}`)
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), `Enter a real date`);

const optionalDate = (label: string) =>
  z
    .union([z.literal(""), dateField(label)])
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const percent = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((raw, ctx) => {
    const text = raw === null || raw === undefined ? "" : String(raw).trim().replace(/%$/, "");
    if (text === "") return "0.00";
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(text) || Number(text) > 100) {
      ctx.addIssue({ code: "custom", message: "Discount is a percentage from 0 to 100" });
      return z.NEVER;
    }
    return Number(text).toFixed(2);
  });

export const salesLineSchema = z.object({
  productId: z.uuid("Choose a product"),
  unit: z.enum(SELL_UNITS),
  quantity: z.coerce
    .number({ error: "Enter a quantity" })
    .int("Use whole numbers; sell loose pieces with the Piece unit")
    .min(1, "At least 1")
    .max(1_000_000, "Too large"),
  discountPercent: percent,
});

export const draftSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    warehouseId: z.uuid("Choose a warehouse"),
    issueDate: dateField("the date"),
    validUntil: optionalDate("a valid-until date"),
    customerReference: optionalText(100),
    notes: optionalText(2000),
    lines: z.array(salesLineSchema).min(1, "Add at least one product").max(200, "At most 200 lines"),
  })
  .superRefine((v, ctx) => {
    if (v.validUntil && v.validUntil < v.issueDate) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "Must be on or after the date" });
    }
    const seen = new Map<string, number>();
    v.lines.forEach((l, i) => {
      const key = `${l.productId}|${l.unit}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "productId"],
          message: `Same product and unit as line ${seen.get(key)! + 1}; change that line's quantity instead`,
        });
      } else seen.set(key, i);
    });
  });
export type DraftValues = z.output<typeof draftSchema>;

export const updateDraftSchema = z.intersection(draftSchema, z.object({ version: versionField }));

export const postInvoiceSchema = z.object({
  version: versionField,
  /** Optional note when posting past the customer's credit limit (it posts either way). */
  creditOverrideReason: optionalText(500),
});

export const reasonSchema = z.object({
  version: versionField,
  reason: requiredText(500, "Say why"),
});

export const versionOnlySchema = z.object({ version: versionField });

export const taxRateSchema = z.object({
  category: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT"]),
  name: requiredText(60),
  rate: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,4})?$|^100$/, "A percentage such as 16 or 8.5")
    .transform((v) => Number(v).toFixed(4)),
});

export const dispatchSchema = z.object({
  version: versionField,
  vehicle: optionalText(60),
  driver: optionalText(100),
  notes: optionalText(1000),
});

export const deliverSchema = z.object({
  version: versionField,
  receivedBy: requiredText(100, "Who received the goods?"),
  notes: optionalText(1000),
});
