import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { TaxCategory } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { ConflictError, NotFoundError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { taxRateSchema, versionOnlySchema } from "./schemas";

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
