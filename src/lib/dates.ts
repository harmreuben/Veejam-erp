/**
 * Calendar dates (no time of day) as "YYYY-MM-DD" strings, in Kenyan time.
 * Postgres DATE columns are read and written as midnight UTC on that date.
 */

const nairobiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Nairobi",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Nairobi, e.g. "2026-10-21". */
export function todayInNairobi(now: Date = new Date()): string {
  return nairobiDay.format(now);
}

export function toDbDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError(`Not a date: ${day}`);
  return new Date(`${day}T00:00:00.000Z`);
}

export function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = toDbDate(day);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** First day of the month: "2026-10-21" → "2026-10-01". */
export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** Monday of the week the day falls in. */
export function startOfWeek(day: string): string {
  const d = toDbDate(day);
  const weekday = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -weekday);
}

/** Last day of the month. */
export function endOfMonth(day: string): string {
  const d = toDbDate(startOfMonth(day));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromDbDate(d);
}

/** First day of the previous month. */
export function startOfPreviousMonth(day: string): string {
  return startOfMonth(addDays(startOfMonth(day), -1));
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / 86_400_000);
}

export type DayRange = { from: string; to: string };

/** Named periods used by reports and WhatsApp commands, ending today. */
export function periodRange(period: "today" | "yesterday" | "week" | "month", today: string): DayRange {
  switch (period) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "week":
      return { from: startOfWeek(today), to: today };
    case "month":
      return { from: startOfMonth(today), to: today };
  }
}

const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const longDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const monthName = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** "21 Oct" */
export const formatShortDay = (day: string) => shortDay.format(toDbDate(day));
/** "21 Oct 2026" */
export const formatLongDay = (day: string) => longDay.format(toDbDate(day));
/** "Oct 2026" from "2026-10" or a full date. */
export const formatMonth = (day: string) => monthName.format(toDbDate(`${day.slice(0, 7)}-01`));
