import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "@/server/db/client";

/** Stable action names. Add new ones here so reports can rely on them. */
export type AuditAction =
  | "AUTH_SIGNED_IN"
  | "AUTH_SIGN_IN_FAILED"
  | "AUTH_SIGNED_OUT"
  | "AUTH_PASSWORD_CHANGED"
  | "SETTINGS_UPDATED"
  | "USER_ACCESS_GRANTED"
  | "USER_ROLE_CHANGED"
  | "USER_DEACTIVATED"
  | "USER_REACTIVATED"
  | "LEGACY_FILE_STAGED"
  | "SEED_APPLIED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRICE_LIST_CREATED"
  | "PRICE_LIST_UPDATED"
  | "PRICES_CHANGED"
  | "DEFAULT_PRICE_LIST_CHANGED"
  | "CUSTOMER_CREATED"
  | "CUSTOMER_UPDATED"
  | "SUPPLIER_CREATED"
  | "SUPPLIER_UPDATED"
  | "WAREHOUSE_CREATED"
  | "WAREHOUSE_UPDATED"
  | "STOCK_ADJUSTED"
  | "STOCK_TRANSFERRED"
  | "STOCK_COUNT_STARTED"
  | "STOCK_COUNT_POSTED"
  | "STOCK_COUNT_CANCELLED"
  | "IMPORT_VALIDATED"
  | "IMPORT_COMMITTED"
  | "IMPORT_CANCELLED"
  | "TAX_RATE_CHANGED"
  | "SALES_DOCUMENT_CREATED"
  | "SALES_DOCUMENT_UPDATED"
  | "SALES_DOCUMENT_CONVERTED"
  | "SALES_DOCUMENT_CANCELLED"
  | "QUOTATION_STATUS_CHANGED"
  | "SALES_ORDER_CONFIRMED"
  | "INVOICE_REPRICED"
  | "INVOICE_POSTED"
  | "DELIVERY_NOTE_CREATED"
  | "DELIVERY_DISPATCHED"
  | "DELIVERY_DELIVERED"
  | "DELIVERY_CANCELLED"
  | "SHARE_LINK_CREATED"
  | "SHARE_LINK_REVOKED"
  | "LEGACY_IMPORTED"
  | "PAYMENT_RECORDED"
  | "PAYMENT_REVERSED"
  | "CREDIT_APPLIED"
  | "CREDIT_NOTE_POSTED"
  | "JOURNAL_POSTED"
  | "BOOKS_CLOSED"
  | "ACCOUNT_CREATED"
  | "ACCOUNT_UPDATED"
  | "OPENING_BALANCES_POSTED"
  | "WHATSAPP_NUMBER_LINKED"
  | "WHATSAPP_COMMAND_CONFIRMED"
  | "WHATSAPP_SENDER_REFUSED"
  | "AUDIT_EXPORTED"
  | "BACKUP_TAKEN"
  | "BACKUP_RESTORED"
  | "RATE_LIMITED";

export type AuditEntry = {
  actorUserId?: string | null;
  actorLabel: string;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** Keys whose values must never be written to the audit log. */
const REDACTED_KEYS = /pass(word)?|secret|token|key|authorization|cookie/i;

/** Recursively replace sensitive values with "[redacted]". */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        REDACTED_KEYS.test(k) ? "[redacted]" : redact(v),
      ]),
    ) as T;
  }
  return value;
}

/**
 * Write one audit entry. Pass the transaction (`tx`) used for the change itself,
 * so the change and its audit record are committed together or not at all.
 */
export async function writeAudit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      actorLabel: entry.actorLabel,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: entry.before === undefined ? undefined : redact(entry.before),
      after: entry.after === undefined ? undefined : redact(entry.after),
      metadata: entry.metadata === undefined ? undefined : redact(entry.metadata),
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ? entry.userAgent.slice(0, 300) : null,
    },
  });
}

/** Only the fields that changed, as { before, after }. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
