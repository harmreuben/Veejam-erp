import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { TaxCategory } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput, isUuid } from "@/server/shared/validation";

import { deliverSchema, dispatchSchema, reasonSchema, taxRateSchema, versionOnlySchema } from "./schemas";

const auditBase = (actor: Actor, ctx: AuditContext) => ({
  actorUserId: actor.id,
  actorLabel: actor.email,
  ...ctx,
});

// ─── Tax rates ──────────────────────────────────────────────────────

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  STANDARD: "Standard rate",
  ZERO_RATED: "Zero-rated",
  EXEMPT: "Exempt",
};

export async function listTaxRates(db: Db, actor: Actor) {
  authorize(actor, "settings.view");
  const rows = await db.taxRate.findMany({ include: { updatedBy: { select: { fullName: true } } } });
  const order: TaxCategory[] = ["STANDARD", "ZERO_RATED", "EXEMPT"];
  return rows
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
    .map((r) => ({ ...r, rate: r.rate.toFixed(4) }));
}

/** Change a tax rate. Posted invoices keep the rate they were posted with; drafts pick up the new rate on their next save. */
export async function updateTaxRate(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "tax.manage");
  const values = parseInput(taxRateSchema, input);
  await db.$transaction(async (tx) => {
    const before = await tx.taxRate.findUnique({ where: { category: values.category } });
    if (before && before.rate.toFixed(4) === values.rate && before.name === values.name) return;
    await tx.taxRate.upsert({
      where: { category: values.category },
      create: { ...values, updatedById: actor.id },
      update: { name: values.name, rate: values.rate, updatedById: actor.id },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "TAX_RATE_CHANGED",
      entityType: "TaxRate",
      summary: `${TAX_CATEGORY_LABELS[values.category]}: ${before?.rate.toFixed(2) ?? "none"}% → ${Number(values.rate)}%`,
      before: before ? { name: before.name, rate: before.rate.toFixed(4) } : undefined,
      after: { name: values.name, rate: values.rate },
    });
  });
}

// ─── Delivery notes ─────────────────────────────────────────────────

export const DELIVERY_STATUS_LABELS = {
  PREPARED: "Prepared",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
} as const;

/** Make the delivery note for a posted invoice. Making it twice returns the first one. */
export async function createDeliveryNote(
  db: Db,
  actor: Actor,
  invoiceId: string,
  ctx: AuditContext = {},
): Promise<{ id: string; number: string }> {
  authorize(actor, "delivery.manage");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${invoiceId}::uuid FOR UPDATE`;
    const invoice = await tx.salesDocument.findUnique({
      where: { id: invoiceId },
      include: { deliveryNote: true, customer: { select: { name: true } } },
    });
    if (!invoice || invoice.kind !== "INVOICE") throw new NotFoundError();
    if (invoice.deliveryNote) return { id: invoice.deliveryNote.id, number: invoice.deliveryNote.number };
    if (invoice.status !== "POSTED")
      throw new ConflictError("Post the invoice before making its delivery note.");
    const number = await nextNumber(tx, "DELIVERY_NOTE");
    const note = await tx.deliveryNote.create({ data: { number, invoiceId, createdById: actor.id } });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "DELIVERY_NOTE_CREATED",
      entityType: "DeliveryNote",
      entityId: note.id,
      summary: `${number} for ${invoice.number} (${invoice.customer.name})`,
    });
    return { id: note.id, number };
  });
}

async function lockNote(tx: DbOrTx, id: string, version: number) {
  await tx.$queryRaw`SELECT id FROM delivery_notes WHERE id = ${id}::uuid FOR UPDATE`;
  const note = await tx.deliveryNote.findUnique({ where: { id } });
  if (!note) throw new NotFoundError();
  if (note.version !== version) {
    throw new ConflictError(`${note.number} was changed by someone else. Reload to see the latest.`);
  }
  return note;
}

export async function dispatchDelivery(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "delivery.manage");
  const values = parseInput(dispatchSchema, input);
  await db.$transaction(async (tx) => {
    const note = await lockNote(tx, id, values.version);
    if (note.status !== "PREPARED")
      throw new ConflictError(`${note.number} is already ${note.status.toLowerCase()}.`);
    await tx.deliveryNote.update({
      where: { id },
      data: {
        status: "DISPATCHED",
        dispatchedAt: new Date(),
        vehicle: values.vehicle,
        driver: values.driver,
        notes: values.notes ?? note.notes,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "DELIVERY_DISPATCHED",
      entityType: "DeliveryNote",
      entityId: id,
      summary: `${note.number} dispatched${values.vehicle ? ` on ${values.vehicle}` : ""}`,
    });
  });
}

export async function markDelivered(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "delivery.manage");
  const values = parseInput(deliverSchema, input);
  await db.$transaction(async (tx) => {
    const note = await lockNote(tx, id, values.version);
    if (note.status === "DELIVERED" || note.status === "CANCELLED") {
      throw new ConflictError(`${note.number} is already ${note.status.toLowerCase()}.`);
    }
    const now = new Date();
    await tx.deliveryNote.update({
      where: { id },
      data: {
        status: "DELIVERED",
        dispatchedAt: note.dispatchedAt ?? now,
        deliveredAt: now,
        receivedBy: values.receivedBy,
        notes: values.notes ?? note.notes,
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "DELIVERY_DELIVERED",
      entityType: "DeliveryNote",
      entityId: id,
      summary: `${note.number} delivered, received by ${values.receivedBy}`,
    });
  });
}

/** Cancel a delivery that didn't happen. The invoice and stock are untouched (returns come with credit notes in Phase 5). */
export async function cancelDelivery(
  db: Db,
  actor: Actor,
  id: string,
  input: unknown,
  ctx: AuditContext = {},
) {
  authorize(actor, "delivery.manage");
  const values = parseInput(reasonSchema, input);
  await db.$transaction(async (tx) => {
    const note = await lockNote(tx, id, values.version);
    if (note.status === "DELIVERED" || note.status === "CANCELLED") {
      throw new ConflictError(`${note.number} is ${note.status.toLowerCase()} and can't be cancelled.`);
    }
    await tx.deliveryNote.update({
      where: { id },
      data: {
        status: "CANCELLED",
        notes: [note.notes, `Cancelled: ${values.reason}`].filter(Boolean).join("\n"),
        version: { increment: 1 },
      },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "DELIVERY_CANCELLED",
      entityType: "DeliveryNote",
      entityId: id,
      summary: `${note.number} cancelled: ${values.reason}`,
    });
  });
}

export async function listDeliveryNotes(db: Db, actor: Actor, filter: { status?: string; q?: string } = {}) {
  authorize(actor, "sales.view");
  const q = filter.q?.trim();
  return db.deliveryNote.findMany({
    where: {
      ...(filter.status && filter.status in DELIVERY_STATUS_LABELS
        ? { status: filter.status as keyof typeof DELIVERY_STATUS_LABELS }
        : {}),
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" as const } },
              { invoice: { number: { contains: q, mode: "insensitive" as const } } },
              { invoice: { customer: { name: { contains: q, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
    include: {
      invoice: {
        select: { id: true, number: true, total: true, customer: { select: { name: true, town: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
}

export async function getDeliveryNote(db: Db, actor: Actor, id: string) {
  authorize(actor, "sales.view");
  if (!isUuid(id)) throw new NotFoundError();
  const note = await db.deliveryNote.findUnique({
    where: { id },
    include: {
      createdBy: { select: { fullName: true } },
      invoice: {
        include: {
          customer: true,
          warehouse: { select: { name: true } },
          lines: {
            orderBy: { position: "asc" },
            include: { product: { select: { unitsPerPack: true, packsPerCarton: true } } },
          },
        },
      },
    },
  });
  if (!note) throw new NotFoundError();
  return note;
}

// ─── Share links ────────────────────────────────────────────────────

export const SHARE_LINK_DAYS = 30;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Make a link a customer can open without an account. The token is random
 * (256 bits) and shown once; only its hash is stored. Links expire and can be revoked.
 */
export async function createShareLink(
  db: Db,
  actor: Actor,
  documentId: string,
  ctx: AuditContext = {},
): Promise<{ token: string; expiresAt: Date }> {
  authorize(actor, "documents.share");
  const doc = await db.salesDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError();
  if (doc.status === "CANCELLED") throw new ConflictError("A cancelled document can't be shared.");
  if (doc.kind === "INVOICE" && doc.status !== "POSTED") {
    throw new ConflictError("Post the invoice before sharing it; drafts aren't invoices yet.");
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SHARE_LINK_DAYS * 24 * 60 * 60 * 1000);
  await db.$transaction(async (tx) => {
    const link = await tx.documentShareLink.create({
      data: { documentId, tokenHash: hashShareToken(token), expiresAt, createdById: actor.id },
    });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SHARE_LINK_CREATED",
      entityType: "DocumentShareLink",
      entityId: link.id,
      summary: `Share link for ${doc.number ?? "draft"}, valid ${SHARE_LINK_DAYS} days`,
    });
  });
  return { token, expiresAt };
}

export async function revokeShareLink(db: Db, actor: Actor, linkId: string, ctx: AuditContext = {}) {
  authorize(actor, "documents.share");
  await db.$transaction(async (tx) => {
    const link = await tx.documentShareLink.findUnique({
      where: { id: linkId },
      include: { document: { select: { number: true } } },
    });
    if (!link) throw new NotFoundError();
    if (link.revokedAt) return;
    await tx.documentShareLink.update({ where: { id: linkId }, data: { revokedAt: new Date() } });
    await writeAudit(tx, {
      ...auditBase(actor, ctx),
      action: "SHARE_LINK_REVOKED",
      entityType: "DocumentShareLink",
      entityId: linkId,
      summary: `Share link for ${link.document.number ?? "draft"} revoked`,
    });
  });
}

/**
 * Look up a share token from a public URL. Returns the document id, or null
 * for unknown, expired, revoked or cancelled — all treated the same, so the
 * page reveals nothing about which.
 */
export async function resolveShareToken(db: Db, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const link = await db.documentShareLink.findUnique({
    where: { tokenHash: hashShareToken(token) },
    include: { document: { select: { status: true } } },
  });
  if (!link || link.revokedAt || link.expiresAt <= new Date() || link.document.status === "CANCELLED")
    return null;
  await db.documentShareLink.update({
    where: { id: link.id },
    data: { accessCount: { increment: 1 }, lastAccessedAt: new Date() },
  });
  return link.documentId;
}

export { versionOnlySchema };
