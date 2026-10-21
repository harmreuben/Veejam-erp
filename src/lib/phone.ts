/**
 * Kenyan phone numbers.
 *
 * Stored in one canonical form, international digits without "+": 2547XXXXXXXX
 * or 2541XXXXXXXX. That is also the form WhatsApp and M-Pesa use, so the same
 * customer can be matched across all three. Placeholders such as "0700" or
 * "07" (common in the old system) are rejected rather than stored.
 */

const MOBILE = /^254[17]\d{8}$/;

/** Returns the canonical number, or null if the input isn't a valid Kenyan mobile number. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  let candidate: string;
  if (digits.startsWith("254")) candidate = digits;
  else if (digits.startsWith("0")) candidate = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) candidate = `254${digits}`;
  else return null;
  if (!MOBILE.test(candidate)) return null;
  // Obvious placeholders: all the same digit after the prefix (0700000000, 0711111111).
  if (/^254[17](\d)\1{7}$/.test(candidate)) return null;
  return candidate;
}

/** 254712345678 → "0712 345 678" for display. */
export function formatKenyanPhone(canonical: string | null | undefined): string {
  if (!canonical || !MOBILE.test(canonical)) return canonical ?? "";
  const local = `0${canonical.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
