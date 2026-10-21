import { z } from "zod";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { moneyField, optionalText, requiredText, versionField } from "@/server/shared/validation";

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  MPESA: "M-Pesa",
  BANK_TRANSFER: "Bank transfer",
  CHEQUE: "Cheque",
};

const day = z
  .string({ error: "Enter the date" })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

export const allocationSchema = z.object({
  invoiceId: z.uuid(),
  amount: moneyField({ allowBlank: true, min: "0" }),
});

export const paymentSchema = z
  .object({
    customerId: z.uuid("Choose a customer"),
    receivedOn: day,
    method: z.enum(["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE"], { error: "Choose how they paid" }),
    reference: optionalText(40),
    amount: moneyField({ min: "0.01", label: "the amount received" }),
    notes: optionalText(1000),
    idempotencyKey: z.uuid(),
    /** "auto": oldest invoices first. "manual": the amounts in allocations. */
    allocate: z.enum(["auto", "manual"]).default("auto"),
    allocations: z.array(allocationSchema).max(500).default([]),
  })
  .transform((v) => ({
    ...v,
    amount: v.amount as string,
    reference: v.reference ? v.reference.toUpperCase().replace(/\s+/g, "") : null,
    allocations: v.allocations.filter((a) => a.amount !== null && Number(a.amount) > 0) as {
      invoiceId: string;
      amount: string;
    }[],
  }))
  .superRefine((v, ctx) => {
    if (v.method === "MPESA" && !/^[A-Z0-9]{10}$/.test(v.reference ?? "")) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Enter the 10-character M-Pesa code from the confirmation message, e.g. SJK3H7QW2P",
      });
    }
    if (v.method === "CHEQUE" && !v.reference) {
      ctx.addIssue({ code: "custom", path: ["reference"], message: "Enter the cheque number" });
    }
  });

export const applyCreditSchema = z.object({
  allocations: z.array(allocationSchema).min(1).max(500),
});

export const reverseSchema = z.object({
  version: versionField,
  reason: requiredText(500, "Say why it's being reversed"),
});

export const creditNoteSchema = z.object({
  idempotencyKey: z.uuid(),
  reason: requiredText(500, "Say why the credit note is being issued"),
  returnsToStock: z
    .unknown()
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  lines: z
    .array(
      z.object({
        lineId: z.uuid(),
        quantity: z.coerce
          .number()
          .int("Whole numbers only")
          .min(0, "Can't be negative")
          .max(1_000_000)
          .default(0),
      }),
    )
    .max(200),
});

export const journalSchema = z.object({
  date: day,
  description: requiredText(300, "Describe the entry, e.g. October rent"),
  lines: z
    .array(
      z.object({
        accountId: z.union([z.literal(""), z.uuid()]).optional(),
        debit: moneyField({ allowBlank: true, min: "0" }),
        credit: moneyField({ allowBlank: true, min: "0" }),
        description: optionalText(200),
      }),
    )
    .max(50),
});

export const closeBooksSchema = z.object({
  booksClosedUntil: z.union([z.literal(""), day]).transform((v) => (v === "" ? null : v)),
});

export const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "A 4-digit code, e.g. 6500"),
  name: requiredText(100, "Name the account"),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]),
});
