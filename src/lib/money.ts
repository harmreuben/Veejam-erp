import Decimal from "decimal.js";

/**
 * Decimal-safe money helpers.
 *
 * JavaScript numbers are binary floating point: 0.1 + 0.2 !== 0.3.
 * Every monetary calculation in VeeJam ERP must go through these helpers
 * (or Decimal directly) and must never use plain `number` arithmetic.
 *
 * Amounts are KES with 2 decimal places. Rounding is ROUND_HALF_UP,
 * the usual commercial convention. Confirm the rounding rule with the
 * company's accountant before production use.
 */

export const MONEY_SCALE = 2;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type MoneyInput = Decimal.Value;

/** Parse a value into a Decimal, rejecting NaN and Infinity. */
export function toDecimal(value: MoneyInput): Decimal {
  const d = new D(value);
  if (!d.isFinite()) {
    throw new RangeError(`Invalid monetary value: ${String(value)}`);
  }
  return d;
}

/** Round to 2 decimal places (KES cents). */
export function roundMoney(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

/** Sum a list of amounts exactly, then round once. */
export function sumMoney(values: readonly MoneyInput[]): Decimal {
  return roundMoney(values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new D(0)));
}

/** quantity × unit price, rounded to cents. */
export function lineAmount(quantity: MoneyInput, unitPrice: MoneyInput): Decimal {
  return roundMoney(toDecimal(quantity).times(toDecimal(unitPrice)));
}

/** Apply a percentage (e.g. 16 for 16%) to an amount, rounded to cents. */
export function percentOf(amount: MoneyInput, percent: MoneyInput): Decimal {
  return roundMoney(toDecimal(amount).times(toDecimal(percent)).dividedBy(100));
}

/** Format for display, e.g. "KES 1,250.50". Display only — never parse this back. */
export function formatKES(value: MoneyInput): string {
  const fixed = roundMoney(value).toFixed(MONEY_SCALE);
  const [whole = "0", cents = "00"] = fixed.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = fixed.startsWith("-") ? "-" : "";
  return `${sign}KES ${grouped}.${cents}`;
}
