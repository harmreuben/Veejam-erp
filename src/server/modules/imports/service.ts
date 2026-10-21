import "server-only";

import { createHash } from "node:crypto";

import { parse } from "csv-parse/sync";
import type { z } from "zod";

import type { ImportKind } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor, type Permission } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { applyProductUpdate, insertProduct } from "@/server/modules/catalogue/service";
import { applyCustomerUpdate, insertCustomer, nameKey } from "@/server/modules/customers/service";
import { getDefaultPriceListId, writePrices, type AuditContext } from "@/server/modules/pricing/service";
import { applySupplierUpdate, insertSupplier } from "@/server/modules/suppliers/service";

import {
  IMPORT_COLUMNS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  customerRowInput,
  customerRowSchema,
  issuesToMessages,
  normaliseHeader,
  productRowInput,
  productRowSchema,
  supplierRowInput,
  supplierRowSchema,
} from "./definitions";

type Raw = Record<string, string>;
type Checked<V> = {
  rowNumber: number;
  raw: Raw;
  action: "CREATE" | "UPDATE" | null;
  errors: string[];
  targetId?: string;
  values?: V;
};

const PERMISSIONS_FOR: Record<ImportKind, Permission[]> = {
  PRODUCTS: ["catalogue.manage", "catalogue.costs", "pricing.manage"],
  CUSTOMERS: ["customers.manage", "customers.credit"],
  SUPPLIERS: ["suppliers.manage"],
};

function authorizeImport(actor: Actor, kind: ImportKind) {
  authorize(actor, "imports.run");
  for (const p of PERMISSIONS_FOR[kind]) authorize(actor, p);
}

/** Read the CSV and check its shape (size, headers). Rows are returned untouched. */
export function readImportFile(
  kind: ImportKind,
  fileName: string,
  content: Buffer,
): { rows: Raw[]; sha256: string } {
  if (!/\.csv$/i.test(fileName))
    throw new ValidationError({ file: ["Upload a .csv file (in Excel: File → Save As → CSV UTF-8)"] });
  if (content.byteLength === 0) throw new ValidationError({ file: ["The file is empty"] });
  if (content.byteLength > MAX_IMPORT_BYTES)
    throw new ValidationError({ file: ["The file is larger than 2 MB; split it into smaller files"] });
  let records: Raw[];
  try {
    records = parse(content, {
      columns: (header: string[]) => header.map(normaliseHeader),
      bom: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (error) {
    throw new ValidationError({ file: [`This isn't a readable CSV file (${(error as Error).message})`] });
  }
  if (!records.length) throw new ValidationError({ file: ["The file has headers but no rows"] });
  if (records.length > MAX_IMPORT_ROWS) {
    throw new ValidationError({
      file: [`At most ${MAX_IMPORT_ROWS.toLocaleString()} rows per file; this has ${records.length}`],
    });
  }
  const headers = Object.keys(records[0]!);
  const known = IMPORT_COLUMNS[kind].map((c) => c.name);
  const missing = IMPORT_COLUMNS[kind]
    .filter((c) => c.required && !headers.includes(c.name))
    .map((c) => c.name);
  const unknown = headers.filter((h) => !known.includes(h));
  const problems: string[] = [];
  if (missing.length) problems.push(`Missing required column(s): ${missing.join(", ")}`);
  if (unknown.length)
    problems.push(
      `Unrecognised column(s): ${unknown.join(", ")}. Download the template for the exact names.`,
    );
  if (problems.length) throw new ValidationError({ file: problems });
  return { rows: records, sha256: createHash("sha256").update(content).digest("hex") };
}

function parseRow<S extends z.ZodType>(
  schema: S,
  input: unknown,
): { values?: z.output<S>; errors: string[] } {
  const r = schema.safeParse(input);
  return r.success ? { values: r.data, errors: [] } : { errors: issuesToMessages(r.error) };
}

const yes = (v: string | undefined) => /^(y|yes|true|1)$/i.test(v?.trim() ?? "");

/** Validate every row against the current database. Used both for the preview and again at commit. */
async function checkRows(tx: DbOrTx, kind: ImportKind, rows: Raw[]): Promise<Checked<unknown>[]> {
  const out: Checked<unknown>[] = rows.map((raw, i) => ({ rowNumber: i + 2, raw, action: null, errors: [] }));

  if (kind === "PRODUCTS") {
    const parsed = out.map((r) => ({ r, ...parseRow(productRowSchema, productRowInput(r.raw)) }));
    const skus = parsed.flatMap((p) => (p.values ? [p.values.sku] : []));
    const barcodes = parsed.flatMap((p) => (p.values?.barcode ? [p.values.barcode] : []));
    const existing = await tx.product.findMany({
      where: { OR: [{ sku: { in: skus } }, ...(barcodes.length ? [{ barcode: { in: barcodes } }] : [])] },
    });
    const bySku = new Map(existing.map((p) => [p.sku, p]));
    const seenSku = new Map<string, number>();
    const seenBarcode = new Map<string, number>();
    for (const { r, values, errors } of parsed) {
      r.errors.push(...errors);
      if (!values) continue;
      const dupe = seenSku.get(values.sku);
      if (dupe) r.errors.push(`sku: ${values.sku} also appears on row ${dupe}`);
      seenSku.set(values.sku, r.rowNumber);
      if (values.barcode) {
        const d = seenBarcode.get(values.barcode);
        if (d) r.errors.push(`barcode: also used on row ${d}`);
        seenBarcode.set(values.barcode, r.rowNumber);
        const owner = existing.find((p) => p.barcode === values.barcode);
        if (owner && owner.sku !== values.sku)
          r.errors.push(`barcode: already used by ${owner.sku} ${owner.name}`);
      }
      const current = bySku.get(values.sku);
      r.action = r.errors.length ? null : current ? "UPDATE" : "CREATE";
      r.targetId = current?.id;
      r.values = values;
    }
    return out;
  }

  if (kind === "CUSTOMERS") {
    const lists = await tx.priceList.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true },
    });
    const listByCode = new Map(lists.map((l) => [l.code, l.id]));
    const codes = out.map((r) => r.raw.code?.trim().toUpperCase()).filter(Boolean) as string[];
    const existingByCode = new Map(
      (await tx.customer.findMany({ where: { code: { in: codes } } })).map((c) => [c.code, c]),
    );
    const all = await tx.customer.findMany({ select: { id: true, code: true, name: true, kraPin: true } });
    const byName = new Map<string, { id: string; code: string }[]>();
    for (const c of all) byName.set(nameKey(c.name), [...(byName.get(nameKey(c.name)) ?? []), c]);
    const seenCode = new Map<string, number>();
    const seenPin = new Map<string, number>();
    const seenName = new Map<string, number>();

    for (const r of out) {
      const { values, errors } = parseRow(customerRowSchema, customerRowInput(r.raw));
      r.errors.push(...errors);
      const code = r.raw.code?.trim().toUpperCase() || null;
      const current = code ? existingByCode.get(code) : undefined;
      if (code) {
        if (!current) r.errors.push(`code: no customer ${code}; leave code blank to create a new one`);
        const d = seenCode.get(code);
        if (d) r.errors.push(`code: ${code} also appears on row ${d}`);
        seenCode.set(code, r.rowNumber);
      }
      const listCode = r.raw.price_list?.trim().toUpperCase();
      let priceListId: string | null = null;
      if (listCode) {
        priceListId = listByCode.get(listCode) ?? null;
        if (!priceListId) r.errors.push(`price_list: no active price list ${listCode}`);
      }
      // Duplicate names are checked from the raw name, so they're reported even when other fields are wrong.
      const rawName = r.raw.name?.trim() ?? "";
      if (rawName) {
        const key = nameKey(rawName);
        const sameInDb = (byName.get(key) ?? []).filter((c) => c.id !== current?.id);
        const sameInFile = seenName.get(key);
        if (!current && !yes(r.raw.allow_duplicate_name) && (sameInDb.length || sameInFile)) {
          r.errors.push(
            sameInDb.length
              ? `name: already exists as ${sameInDb.map((c) => c.code).join(", ")}. Put that code in the code column to update it, or allow_duplicate_name = YES if it's a different business.`
              : `name: also appears on row ${sameInFile}. Merge the rows, or set allow_duplicate_name = YES.`,
          );
        }
        seenName.set(key, r.rowNumber);
      }
      if (values) {
        if (values.kraPin) {
          const d = seenPin.get(values.kraPin);
          if (d) r.errors.push(`kra_pin: also used on row ${d}`);
          seenPin.set(values.kraPin, r.rowNumber);
          const owner = all.find((c) => c.kraPin === values.kraPin);
          if (owner && owner.id !== current?.id)
            r.errors.push(`kra_pin: belongs to ${owner.code} ${owner.name}`);
        }
        r.values = { ...values, priceListId: priceListId ?? (current ? current.priceListId : null) };
      }
      r.targetId = current?.id;
      r.action = r.errors.length ? null : current ? "UPDATE" : "CREATE";
    }
    return out;
  }

  // SUPPLIERS
  const codes = out.map((r) => r.raw.code?.trim().toUpperCase()).filter(Boolean) as string[];
  const existingByCode = new Map(
    (await tx.supplier.findMany({ where: { code: { in: codes } } })).map((s) => [s.code, s]),
  );
  const pins = await tx.supplier.findMany({
    where: { kraPin: { not: null } },
    select: { id: true, code: true, kraPin: true },
  });
  const seenCode = new Map<string, number>();
  for (const r of out) {
    const { values, errors } = parseRow(supplierRowSchema, supplierRowInput(r.raw));
    r.errors.push(...errors);
    const code = r.raw.code?.trim().toUpperCase() || null;
    const current = code ? existingByCode.get(code) : undefined;
    if (code) {
      if (!current) r.errors.push(`code: no supplier ${code}; leave code blank to create a new one`);
      const d = seenCode.get(code);
      if (d) r.errors.push(`code: ${code} also appears on row ${d}`);
      seenCode.set(code, r.rowNumber);
    }
    if (values?.kraPin) {
      const owner = pins.find((p) => p.kraPin === values.kraPin);
      if (owner && owner.id !== current?.id) r.errors.push(`kra_pin: belongs to ${owner.code}`);
    }
    r.values = values;
    r.targetId = current?.id;
    r.action = r.errors.length ? null : current ? "UPDATE" : "CREATE";
  }
  return out;
}

/** Step 1: upload and check. Nothing is written to customers/products yet. */
export async function validateImport(
  db: Db,
  actor: Actor,
  kind: ImportKind,
  fileName: string,
  content: Buffer,
  ctx: AuditContext = {},
) {
  authorizeImport(actor, kind);
  const { rows, sha256 } = readImportFile(kind, fileName, content);
  return db.$transaction(
    async (tx) => {
      const checked = await checkRows(tx, kind, rows);
      const errorRows = checked.filter((r) => r.errors.length).length;
      const job = await tx.importJob.create({
        data: {
          kind,
          fileName: fileName.slice(0, 200),
          fileSha256: sha256,
          totalRows: rows.length,
          errorRows,
          createdById: actor.id,
          rows: {
            create: checked.map((r) => ({
              rowNumber: r.rowNumber,
              data: r.raw,
              action: r.action,
              errors: r.errors,
            })),
          },
        },
      });
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "IMPORT_VALIDATED",
        entityType: "ImportJob",
        entityId: job.id,
        summary: `${kind} ${fileName}: ${rows.length} rows, ${errorRows} with errors`,
        ...ctx,
      });
      return job;
    },
    { timeout: 60_000 },
  );
}

/**
 * Step 2: write everything. Re-checks every row against the database as it is
 * now, then creates/updates all records in one transaction: if anything fails,
 * nothing is written. Committing the same import twice is refused.
 */
export async function commitImport(db: Db, actor: Actor, jobId: string, ctx: AuditContext = {}) {
  const job0 = await db.importJob.findUnique({ where: { id: jobId } });
  if (!job0) throw new NotFoundError("That import no longer exists.");
  authorizeImport(actor, job0.kind);

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM import_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.importJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { rows: { orderBy: { rowNumber: "asc" } } },
      });
      if (job.status !== "VALIDATED")
        throw new ConflictError(`This import is already ${job.status.toLowerCase()}.`);
      if (job.errorRows > 0) throw new ConflictError("Fix the rows with errors and upload the file again.");

      const checked = await checkRows(
        tx,
        job.kind,
        job.rows.map((r) => r.data as Raw),
      );
      const nowBad = checked.filter((r) => r.errors.length);
      if (nowBad.length) {
        throw new ConflictError(
          `The data changed since this file was checked: ${nowBad.length} row(s) now have problems ` +
            `(first: row ${nowBad[0]!.rowNumber}: ${nowBad[0]!.errors[0]}). Upload the file again.`,
        );
      }

      const via = `import ${job.fileName}`;
      const summary = { created: 0, updated: 0, unchanged: 0 };
      for (const r of checked) {
        if (job.kind === "PRODUCTS") {
          const { prices, ...values } = r.values as z.output<typeof productRowSchema>;
          if (r.action === "CREATE") {
            await insertProduct(tx, actor, values, prices, { ...ctx, via });
            summary.created++;
          } else {
            const current = await tx.product.findUniqueOrThrow({ where: { id: r.targetId! } });
            const after = await applyProductUpdate(tx, actor, current, values, { ...ctx, via });
            const listId = await getDefaultPriceListId(tx);
            const entries = (["PIECE", "PACK", "CARTON"] as const)
              .filter((u) => prices[u] !== null)
              .map((unit) => ({ productId: current.id, unit, price: prices[unit] }));
            const priceChanges =
              listId && entries.length ? await writePrices(tx, actor, listId, entries, { ...ctx, via }) : 0;
            if (after.version !== current.version || priceChanges) summary.updated++;
            else summary.unchanged++;
          }
        } else if (job.kind === "CUSTOMERS") {
          const values = r.values as z.output<typeof customerRowSchema>;
          if (r.action === "CREATE") {
            await insertCustomer(tx, actor, values, { ...ctx, via });
            summary.created++;
          } else {
            const current = await tx.customer.findUniqueOrThrow({ where: { id: r.targetId! } });
            const after = await applyCustomerUpdate(tx, actor, current, values, { ...ctx, via });
            if (after.version !== current.version) summary.updated++;
            else summary.unchanged++;
          }
        } else {
          const values = r.values as z.output<typeof supplierRowSchema>;
          if (r.action === "CREATE") {
            await insertSupplier(tx, actor, values, { ...ctx, via });
            summary.created++;
          } else {
            const current = await tx.supplier.findUniqueOrThrow({ where: { id: r.targetId! } });
            const after = await applySupplierUpdate(tx, actor, current, values, { ...ctx, via });
            if (after.version !== current.version) summary.updated++;
            else summary.unchanged++;
          }
        }
      }

      await tx.importJob.update({
        where: { id: jobId },
        data: { status: "COMMITTED", committedAt: new Date(), committedById: actor.id, summary },
      });
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "IMPORT_COMMITTED",
        entityType: "ImportJob",
        entityId: jobId,
        summary: `${job.kind} ${job.fileName}: ${summary.created} created, ${summary.updated} updated, ${summary.unchanged} unchanged`,
        after: summary,
        ...ctx,
      });
      return summary;
    },
    { timeout: 120_000 },
  );
}

export async function cancelImport(db: Db, actor: Actor, jobId: string, ctx: AuditContext = {}) {
  authorize(actor, "imports.run");
  return db.$transaction(async (tx) => {
    const updated = await tx.importJob.updateMany({
      where: { id: jobId, status: "VALIDATED" },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) throw new ConflictError("Only an import waiting for review can be cancelled.");
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "IMPORT_CANCELLED",
      entityType: "ImportJob",
      entityId: jobId,
      ...ctx,
    });
  });
}

export async function listImports(db: Db, actor: Actor) {
  authorize(actor, "imports.run");
  return db.importJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { createdBy: { select: { fullName: true } } },
  });
}

export async function getImport(db: Db, actor: Actor, id: string) {
  authorize(actor, "imports.run");
  const job = await db.importJob.findUnique({
    where: { id },
    include: {
      createdBy: { select: { fullName: true } },
      committedBy: { select: { fullName: true } },
      rows: { orderBy: { rowNumber: "asc" } },
    },
  });
  if (!job) throw new NotFoundError("That import doesn't exist.");
  return job;
}
