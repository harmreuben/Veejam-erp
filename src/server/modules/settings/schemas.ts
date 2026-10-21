import { z } from "zod";

import { companyProfileSchema } from "@/config/company";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** KRA PIN: a letter, nine digits, a letter (e.g. P051234567X). */
export const kraPinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{9}[A-Z]$/, "A KRA PIN is a letter, 9 digits and a letter, e.g. P051234567X");

export const companySettingsInputSchema = companyProfileSchema.extend({
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. KES"),
  kraPin: z
    .union([z.literal(""), kraPinSchema])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
  physicalAddress: optionalText(300),
  postalAddress: optionalText(200),
  paymentInstructions: optionalText(1000),
  invoiceTerms: optionalText(2000),
  defaultPaymentTermsDays: z.coerce
    .number()
    .int("Use whole days")
    .min(0, "Can't be negative")
    .max(365, "At most 365 days"),
  /** The version the form was loaded with, for conflict detection. */
  version: z.coerce.number().int().min(1),
});

export type CompanySettingsInput = z.input<typeof companySettingsInputSchema>;
export type CompanySettingsValues = z.output<typeof companySettingsInputSchema>;
