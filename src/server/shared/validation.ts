import { z } from "zod";

import { normalizeKenyanPhone } from "@/lib/phone";
import { toDecimal } from "@/lib/money";
import { ValidationError } from "@/server/errors";

/** Parse input with a Zod schema, or throw a ValidationError listing every bad field. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError(fieldErrors);
}

/** Text that may be blank; blank becomes null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const requiredText = (max: number, message = "Required") =>
  z.string().trim().min(1, message).max(max, `At most ${max} characters`);

/** A code such as a SKU or account number: trimmed, upper-case, no spaces. */
export const codeSchema = (label: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1, `Enter the ${label}`)
    .max(40, "At most 40 characters")
    .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, "Use letters, digits and - . / _ only, no spaces");

export const kraPinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]\d{9}[A-Z]$/, "A KRA PIN is a letter, 9 digits and a letter, e.g. P051234567X");

export const optionalKraPin = z
  .union([z.literal(""), kraPinSchema])
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

export const optionalPhone = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const phone = normalizeKenyanPhone(v);
    if (!phone) {
      ctx.addIssue({ code: "custom", message: "Enter a real Kenyan number, e.g. 0712 345 678" });
      return z.NEVER;
    }
    return phone;
  });

export const optionalEmail = z
  .union([z.literal(""), z.email("Enter a valid email address")])
  .nullable()
  .optional()
  .transform((v) => (v ? v.trim().toLowerCase() : null));

/** A whole number from a form field ("12" → 12). */
export const intField = (label: string, min: number, max: number) =>
  z.coerce
    .number({ error: `Enter the ${label} as a number` })
    .int(`${label[0]!.toUpperCase()}${label.slice(1)} must be a whole number`)
    .min(min, `At least ${min}`)
    .max(max, `At most ${max.toLocaleString("en-KE")}`);

/**
 * A money amount typed by a person ("1,250.50"), kept as an exact decimal
 * string with at most 2 decimal places. Never converted to a JS number.
 */
export const moneyField = (opts: { min?: string; allowBlank?: boolean; label?: string } = {}) =>
  z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((raw, ctx) => {
      const text = raw === null || raw === undefined ? "" : String(raw).trim().replace(/,/g, "");
      if (text === "") {
        if (opts.allowBlank) return null;
        ctx.addIssue({ code: "custom", message: `Enter ${opts.label ?? "an amount"}` });
        return z.NEVER;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(text)) {
        ctx.addIssue({ code: "custom", message: "Use digits with up to 2 decimal places, e.g. 1250.50" });
        return z.NEVER;
      }
      const d = toDecimal(text);
      if (opts.min !== undefined && d.lessThan(opts.min)) {
        ctx.addIssue({ code: "custom", message: `Must be at least ${opts.min}` });
        return z.NEVER;
      }
      if (d.greaterThanOrEqualTo("10000000000000000")) {
        ctx.addIssue({ code: "custom", message: "Amount is too large" });
        return z.NEVER;
      }
      return d.toFixed(2);
    });

/** Optimistic-locking version sent back by edit forms. */
export const versionField = z.coerce.number().int().min(1);
