/**
 * CSV for spreadsheets. Text that starts with = + - @ (or a tab/CR) is
 * prefixed with an apostrophe so Excel can't run it as a formula
 * (CSV injection). Plain numbers, including negatives, are left as numbers.
 */
export type CsvCell = string | number | null | undefined;

const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text with a byte-order mark, so Excel opens it as UTF-8. */
export function toCsv(rows: CsvCell[][]): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function csvResponse(rows: CsvCell[][], filename: string): Response {
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]/g, "-")}"`,
      "Cache-Control": "no-store",
    },
  });
}
