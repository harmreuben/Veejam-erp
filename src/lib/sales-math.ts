import Decimal from "decimal.js";

import { roundMoney, toDecimal, type MoneyInput } from "@/lib/money";

/**
 * Line and document totals for quotations, orders and invoices.
 *
 * Used by the server (the only place totals are saved) and by the browser
 * for the live preview, so both always agree. Rules:
 *
 *  - list amount  = quantity × unit price, rounded to cents
 *  - discount     = list amount × discount %, rounded to cents
 *  - Prices include VAT (the default): the amount after discount is the gross;
 *    VAT = gross × rate ÷ (100 + rate), rounded; net = gross − VAT.
 *  - Prices exclude VAT: the amount after discount is the net;
 *    VAT = net × rate ÷ 100, rounded; gross = net + VAT.
 *  - Each line is rounded on its own; document totals are the sum of the lines.
 *
 * Rounding is half-up to the cent, per line. Confirm with the accountant.
 */

export type LineInput = {
  quantity: number;
  unitPrice: MoneyInput;
  discountPercent?: MoneyInput;
  /** Percentage, e.g. 16 for 16%. */
  taxRate: MoneyInput;
};

export type LineTotals = {
  /** Before discount, in the price basis (incl. or excl. VAT). */
  listAmount: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
};

export type DocumentTotals = {
  /** Total excluding VAT, after discounts. */
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
};

export function calculateLine(line: LineInput, pricesIncludeTax: boolean): LineTotals {
  if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
    throw new RangeError("Quantity must be a whole number above zero");
  }
  const price = toDecimal(line.unitPrice);
  const discountPercent = toDecimal(line.discountPercent ?? 0);
  const rate = toDecimal(line.taxRate);
  if (price.isNegative()) throw new RangeError("Price can't be negative");
  if (discountPercent.isNegative() || discountPercent.greaterThan(100)) {
    throw new RangeError("Discount must be between 0% and 100%");
  }
  if (rate.isNegative()) throw new RangeError("Tax rate can't be negative");

  const list = roundMoney(price.times(line.quantity));
  const discount = roundMoney(list.times(discountPercent).dividedBy(100));
  const afterDiscount = list.minus(discount);

  let net: Decimal;
  let tax: Decimal;
  let gross: Decimal;
  if (pricesIncludeTax) {
    gross = afterDiscount;
    tax = roundMoney(gross.times(rate).dividedBy(rate.plus(100)));
    net = gross.minus(tax);
  } else {
    net = afterDiscount;
    tax = roundMoney(net.times(rate).dividedBy(100));
    gross = net.plus(tax);
  }
  return {
    listAmount: list.toFixed(2),
    discountAmount: discount.toFixed(2),
    netAmount: net.toFixed(2),
    taxAmount: tax.toFixed(2),
    grossAmount: gross.toFixed(2),
  };
}

export function sumLines(lines: readonly LineTotals[]): DocumentTotals {
  const sum = (key: keyof LineTotals) =>
    lines.reduce((acc, l) => acc.plus(toDecimal(l[key])), toDecimal(0)).toFixed(2);
  return {
    subtotal: sum("netAmount"),
    discountTotal: sum("discountAmount"),
    taxTotal: sum("taxAmount"),
    total: sum("grossAmount"),
  };
}

/** VAT summary per rate, for the bottom of an invoice. */
export function taxBreakdown(
  lines: readonly (LineTotals & { taxRate: MoneyInput })[],
): { rate: string; net: string; tax: string }[] {
  const byRate = new Map<string, { net: Decimal; tax: Decimal }>();
  for (const l of lines) {
    const key = toDecimal(l.taxRate).toFixed(2);
    const row = byRate.get(key) ?? { net: toDecimal(0), tax: toDecimal(0) };
    row.net = row.net.plus(toDecimal(l.netAmount));
    row.tax = row.tax.plus(toDecimal(l.taxAmount));
    byRate.set(key, row);
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => toDecimal(b).comparedTo(toDecimal(a)))
    .map(([rate, v]) => ({ rate, net: v.net.toFixed(2), tax: v.tax.toFixed(2) }));
}

/** "16%" or "8.5%" */
export function formatRate(rate: MoneyInput): string {
  return `${toDecimal(rate).toDecimalPlaces(2).toString()}%`;
}
