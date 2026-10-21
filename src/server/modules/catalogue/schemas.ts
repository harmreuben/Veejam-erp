import { z } from "zod";

import { RecordStatus, TaxCategory } from "@/generated/prisma/enums";
import {
  codeSchema,
  intField,
  moneyField,
  optionalText,
  requiredText,
  versionField,
} from "@/server/shared/validation";

const barcode = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{6,20}$/.test(v), "A barcode is 6 to 20 digits");

/** Prices for the default price list, entered on the product form or in an import. */
export const unitPricesSchema = z.object({
  PIECE: moneyField({ allowBlank: true, min: "0.01" }),
  PACK: moneyField({ allowBlank: true, min: "0.01" }),
  CARTON: moneyField({ allowBlank: true, min: "0.01" }),
});
export type UnitPrices = z.output<typeof unitPricesSchema>;

export const productFieldsSchema = z.object({
  sku: codeSchema("SKU code"),
  barcode,
  name: requiredText(120, "Enter the product name"),
  brand: requiredText(60, "Enter the brand, e.g. Wrigley's"),
  category: requiredText(60, "Enter a category, e.g. Chewing gum"),
  unitsPerPack: intField("pieces per pack", 1, 10_000),
  packsPerCarton: intField("packs per carton", 1, 10_000),
  costPrice: moneyField({ allowBlank: true, min: "0" }),
  taxCategory: z.enum(TaxCategory).default("STANDARD"),
  reorderLevel: intField("reorder level", 0, 100_000_000).default(0),
  status: z.enum(RecordStatus).default("ACTIVE"),
  notes: optionalText(1000),
});
export type ProductValues = z.output<typeof productFieldsSchema>;

export const createProductSchema = productFieldsSchema.extend({
  prices: unitPricesSchema.optional(),
});

export const updateProductSchema = productFieldsSchema.extend({ version: versionField });
