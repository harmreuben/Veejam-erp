import "server-only";

import { z } from "zod";

import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { AppError, ValidationError } from "@/server/errors";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { convertDocument, createDraft, postInvoice } from "./service";

/** What happened to one invoice that was meant to post straight away. */
export type QuickPostResult = {
  id: string;
  /** INV- number once posted. */
  number: string | null;
  posted: boolean;
  /** Why it stayed a draft (stock, credit limit…), in words for the person. */
  problem: string | null;
  customerName: string;
  total: string;
};

/** Turn a service error into one readable sentence (field errors included). */
function describe(error: AppError): string {
  const text =
    error instanceof ValidationError
      ? Object.values(error.fieldErrors).flat().join(" ") || error.message
      : error.message;
  return text.replace(/\s*Nothing was changed\.?$/, "").trim();
}

/**
 * Post a draft invoice now. Business problems (not enough stock, credit limit,
 * prices changed) don't throw: the invoice stays a draft and the reason is
 * returned, so the person can fix it from the draft page.
 */
export async function postDraftNow(
  db: Db,
  actor: Actor,
  id: string,
  ctx: AuditContext = {},
  creditOverrideReason?: string,
): Promise<QuickPostResult> {
  const read = () =>
    db.salesDocument.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        version: true,
        number: true,
        total: true,
        customer: { select: { name: true } },
      },
    });
  const doc = await read();
  const base = { id, customerName: doc.customer.name };
  if (doc.status === "POSTED") {
    return { ...base, number: doc.number, posted: true, problem: null, total: doc.total.toFixed(2) };
  }
  try {
    const r = await postInvoice(db, actor, id, { version: doc.version, creditOverrideReason }, ctx);
    return { ...base, number: r.number, posted: true, problem: null, total: (await read()).total.toFixed(2) };
  } catch (error) {
    if (!(error instanceof AppError) || error.code === "FORBIDDEN") throw error;
    const now = await read();
    return { ...base, number: null, posted: false, problem: describe(error), total: now.total.toFixed(2) };
  }
}

/**
 * Write an invoice and post it in one go. The draft is saved first, so if
 * posting is refused nothing the person typed is lost. A repeated submission
 * with the same key returns the first invoice instead of making another.
 */
export async function createAndPostInvoice(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
  opts: { idempotencyKey?: string; creditOverrideReason?: string } = {},
): Promise<QuickPostResult> {
  authorize(actor, "invoices.post");
  const draft = await createDraft(db, actor, "INVOICE", input, ctx, { idempotencyKey: opts.idempotencyKey });
  return postDraftNow(db, actor, draft.id, ctx, opts.creditOverrideReason);
}

/** Quotation or confirmed order → invoice, posted straight away when possible. */
export async function invoiceAndPost(
  db: Db,
  actor: Actor,
  sourceId: string,
  ctx: AuditContext = {},
): Promise<QuickPostResult> {
  authorize(actor, "invoices.post");
  const r = await convertDocument(db, actor, sourceId, "INVOICE", ctx);
  return postDraftNow(db, actor, r.id, ctx);
}

// ─── Batch: several customers' invoices from one screen ─────────────

const batchLine = z.object({
  productId: z.string(),
  unit: z.string(),
  quantity: z.unknown(),
  discountPercent: z.unknown().optional(),
});

export const batchSchema = z.object({
  warehouseId: z.uuid("Choose where the stock comes from"),
  issueDate: z.string(),
  batchKey: z.uuid(),
  invoices: z
    .array(
      z.object({
        customerId: z.string(),
        customerReference: z.string().optional(),
        lines: z.array(batchLine.optional()).default([]),
      }),
    )
    .min(1, "Add at least one invoice")
    .max(40, "Do at most 40 invoices at a time"),
});

export type BatchItemResult =
  | (QuickPostResult & { index: number })
  | { index: number; id: null; posted: false; problem: string; fieldErrors?: Record<string, string[]> };

/**
 * Write and post several invoices in one go (a day's route, say). Each invoice
 * stands alone: one that can't be posted stays a draft with the reason, or, if
 * it couldn't even be saved (no customer, bad quantity), is reported without
 * stopping the others. Each has its own key, so submitting twice posts once.
 */
export async function postInvoiceBatch(
  db: Db,
  actor: Actor,
  input: unknown,
  ctx: AuditContext = {},
): Promise<BatchItemResult[]> {
  authorize(actor, "invoices.post");
  const v = parseInput(batchSchema, input);
  const results: BatchItemResult[] = [];
  // One after the other, in the order on screen: stock and credit checks see earlier invoices.
  for (const [index, inv] of v.invoices.entries()) {
    const lines = inv.lines.filter((l): l is z.infer<typeof batchLine> => !!l && !!l.productId);
    // A card left completely empty is ignored.
    if (!inv.customerId && lines.length === 0) continue;
    try {
      const r = await createAndPostInvoice(
        db,
        actor,
        {
          customerId: inv.customerId,
          warehouseId: v.warehouseId,
          issueDate: v.issueDate,
          customerReference: inv.customerReference ?? "",
          notes: "",
          lines,
        },
        ctx,
        { idempotencyKey: `batch:${v.batchKey}:${index}` },
      );
      results.push({ ...r, index });
    } catch (error) {
      if (error instanceof ValidationError) {
        results.push({
          index,
          id: null,
          posted: false,
          problem: describe(error),
          fieldErrors: error.fieldErrors,
        });
      } else if (error instanceof AppError && error.code !== "FORBIDDEN") {
        results.push({ index, id: null, posted: false, problem: describe(error) });
      } else throw error;
    }
  }
  return results;
}
