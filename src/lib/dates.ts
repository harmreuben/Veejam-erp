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
