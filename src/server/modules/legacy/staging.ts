import "server-only";

import { createHash } from "node:crypto";

import { parse } from "csv-parse/sync";

import { writeAudit } from "@/server/audit/audit";
import type { Db } from "@/server/db/client";
import { ValidationError } from "@/server/errors";

/** The exports from the previous system and the columns each must have. */
export const LEGACY_FILES = {
  "audit-log": ["date", "action", "entity_type", "details", "performed_by"],
  "commission-records": [
    "invoice_number",
    "invoice_date",
    "customer_name",
    "invoice_total",
    "commission_amount",
  ],
  customers: ["name", "phone", "customer_type", "kra_pin", "credit_limit"],
  "etims-queue": ["invoice_number", "taxable_amount", "vat_amount", "total_amount", "status"],
  "invoice-line-items": ["invoice_number", "sku", "quantity", "unit_price", "line_total"],
  invoices: ["invoice_number", "date", "customer_name", "status", "total_amount", "amount_paid", "balance"],
  payments: ["date", "invoice_number", "amount", "payment_method"],
  "products-inventory": ["sku", "name", "unit_price", "wholesale_price", "stock_quantity"],
  "price-lists": ["sku", "wholesale_price", "retail_unit_price", "units_per_case"],
  "inventory-report": ["sku", "pack_size", "units_per_case", "cases", "loose", "total_units"],
  "stock-movements": ["date", "sku", "movement_type", "quantity", "reference"],
} as const;

export type LegacyFileKind = keyof typeof LEGACY_FILES;

/** "invoices-2026-10-21.csv" → "invoices". Returns null for unrecognised files. */
export function legacyKindFromFileName(fileName: string): LegacyFileKind | null {
  const base = fileName.replace(/\\/g, "/").split("/").pop() ?? "";
  const stem = base.replace(/\.csv$/i, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return stem in LEGACY_FILES ? (stem as LegacyFileKind) : null;
}

export type ParsedLegacyFile = {
  kind: LegacyFileKind;
  columns: string[];
  rows: Record<string, string>[];
  sha256: string;
};

/** Parse and check one export. Values are kept exactly as text; nothing is interpreted. */
export function parseLegacyFile(fileName: string, content: Buffer): ParsedLegacyFile {
  const kind = legacyKindFromFileName(fileName);
  if (!kind) {
    throw new ValidationError({
      file: [`${fileName} is not one of the expected exports (${Object.keys(LEGACY_FILES).join(", ")}).`],
    });
  }
  let rows: Record<string, string>[];
  try {
    rows = parse(content, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: false });
  } catch (error) {
    throw new ValidationError({ file: [`${fileName}: not a valid CSV (${(error as Error).message})`] });
  }
  const columns = rows.length ? Object.keys(rows[0]!) : [];
  const missing = LEGACY_FILES[kind].filter((c) => !columns.includes(c));
  if (missing.length) {
    throw new ValidationError({ file: [`${fileName} is missing column(s): ${missing.join(", ")}`] });
  }
  return { kind, columns, rows, sha256: createHash("sha256").update(content).digest("hex") };
}

export type StageResult = {
  fileName: string;
  kind: LegacyFileKind;
  rows: number;
  status: "staged" | "already staged";
};

/**
 * Store one export in the staging tables, unchanged, so the Phase 3 import can
 * work from a permanent copy. Staging the same file content twice does nothing.
 */
export async function stageLegacyFile(
  db: Db,
  fileName: string,
  content: Buffer,
  actor: { id: string | null; label: string },
): Promise<StageResult> {
  const parsed = parseLegacyFile(fileName, content);
  const sourceFile = fileName.replace(/\\/g, "/").split("/").pop()!;

  return db.$transaction(
    async (tx) => {
      const existing = await tx.legacyImportBatch.findUnique({
        where: { sourceFile_fileSha256: { sourceFile, fileSha256: parsed.sha256 } },
      });
      if (existing)
        return { fileName: sourceFile, kind: parsed.kind, rows: existing.rowCount, status: "already staged" };

      const batch = await tx.legacyImportBatch.create({
        data: {
          sourceFile,
          fileSha256: parsed.sha256,
          rowCount: parsed.rows.length,
          columns: parsed.columns,
          importedById: actor.id,
        },
      });
      // Row numbers match the spreadsheet: the header is row 1, data starts at row 2.
      for (let i = 0; i < parsed.rows.length; i += 500) {
        await tx.legacyRow.createMany({
          data: parsed.rows
            .slice(i, i + 500)
            .map((data, j) => ({ batchId: batch.id, rowNumber: i + j + 2, data })),
        });
      }
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.label,
        action: "LEGACY_FILE_STAGED",
        entityType: "LegacyImportBatch",
        entityId: batch.id,
        summary: `${sourceFile}: ${parsed.rows.length} rows`,
        metadata: { kind: parsed.kind, sha256: parsed.sha256 },
      });
      return { fileName: sourceFile, kind: parsed.kind, rows: parsed.rows.length, status: "staged" as const };
    },
    { timeout: 60_000 },
  );
}
