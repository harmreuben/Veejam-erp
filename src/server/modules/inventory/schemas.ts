import { z } from "zod";

import { AdjustmentReason } from "@/generated/prisma/enums";
import { SELL_UNITS } from "@/lib/units";
import { codeSchema, optionalText, requiredText } from "@/server/shared/validation";

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  OPENING_BALANCE: "Opening balance",
  DAMAGED: "Damaged",
  EXPIRED: "Expired",
  LOST_OR_STOLEN: "Lost or stolen",
  FOUND: "Found",
  SAMPLE_OR_PROMOTION: "Sample or promotion",
  CORRECTION: "Correction",
  OTHER: "Other",
};

/** Which directions each reason allows. Opening balances and finds only add; losses only remove. */
export const REASON_DIRECTIONS: Record<AdjustmentReason, ("IN" | "OUT")[]> = {
  OPENING_BALANCE: ["IN"],
  FOUND: ["IN"],
  DAMAGED: ["OUT"],
  EXPIRED: ["OUT"],
  LOST_OR_STOLEN: ["OUT"],
  SAMPLE_OR_PROMOTION: ["OUT"],
  CORRECTION: ["IN", "OUT"],
  OTHER: ["IN", "OUT"],
};

const qty = z.coerce
  .number({ error: "Enter a quantity" })
  .int("Use whole numbers; enter loose pieces with the Piece unit")
  .min(1, "At least 1")
  .max(1_000_000, "Too large");

const lineBase = z.object({
  productId: z.uuid("Choose a product"),
  unit: z.enum(SELL_UNITS),
  quantity: qty,
});

const noDuplicateProducts = (lines: { productId: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    if (seen.has(l.productId)) {
      ctx.addIssue({
        code: "custom",
        path: ["lines", i, "productId"],
        message: "This product is already on another line",
      });
    }
    seen.add(l.productId);
  });
};

export const adjustmentSchema = z
  .object({
    warehouseId: z.uuid("Choose a warehouse"),
    reason: z.enum(AdjustmentReason),
    notes: optionalText(1000),
    idempotencyKey: z.uuid(),
    lines: z
      .array(lineBase.extend({ direction: z.enum(["IN", "OUT"]) }))
      .min(1, "Add at least one product")
      .max(200, "At most 200 lines"),
  })
  .superRefine((v, ctx) => {
    noDuplicateProducts(v.lines, ctx);
    const allowed = REASON_DIRECTIONS[v.reason];
    v.lines.forEach((l, i) => {
      if (!allowed.includes(l.direction)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", i, "direction"],
          message: `${ADJUSTMENT_REASON_LABELS[v.reason]} can only ${allowed[0] === "IN" ? "add" : "remove"} stock`,
        });
      }
    });
    if ((v.reason === "OTHER" || v.reason === "CORRECTION") && !v.notes) {
      ctx.addIssue({ code: "custom", path: ["notes"], message: "Explain the reason for this adjustment" });
    }
  });

export const transferSchema = z
  .object({
    fromWarehouseId: z.uuid("Choose where the stock comes from"),
    toWarehouseId: z.uuid("Choose where the stock goes"),
    notes: optionalText(1000),
    idempotencyKey: z.uuid(),
    lines: z.array(lineBase).min(1, "Add at least one product").max(200, "At most 200 lines"),
  })
  .superRefine((v, ctx) => {
    noDuplicateProducts(v.lines, ctx);
    if (v.fromWarehouseId === v.toWarehouseId) {
      ctx.addIssue({ code: "custom", path: ["toWarehouseId"], message: "Choose a different warehouse" });
    }
  });

export const startCountSchema = z.object({
  warehouseId: z.uuid("Choose a warehouse"),
  notes: optionalText(1000),
});

const countPart = z
  .union([
    z.literal(""),
    z.coerce.number().int("Whole numbers only").min(0, "Can't be negative").max(1_000_000),
  ])
  .nullable()
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

export const saveCountSchema = z.object({
  version: z.coerce.number().int().min(1),
  lines: z
    .array(z.object({ productId: z.uuid(), cartons: countPart, packs: countPart, pieces: countPart }))
    .max(5000),
});

export const warehouseSchema = z.object({
  code: codeSchema("warehouse code"),
  name: requiredText(80, "Enter a name, e.g. Main store"),
  location: optionalText(200),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});
