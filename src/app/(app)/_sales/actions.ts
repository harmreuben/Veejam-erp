"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SalesDocumentKind } from "@/generated/prisma/enums";
import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { hasPermission } from "@/server/auth/permissions";
import { ValidationError } from "@/server/errors";
import { setFlash } from "@/server/flash";
import {
  cancelDelivery,
  createDeliveryNote,
  createShareLink,
  dispatchDelivery,
  markDelivered,
  revokeShareLink,
  updateTaxRate,
} from "@/server/modules/sales/extras";
import {
  createAndPostInvoice,
  invoiceAndPost,
  postDraftNow,
  postInvoiceBatch,
  type BatchItemResult,
  type QuickPostResult,
} from "@/server/modules/sales/quick-post";
import { KIND_LABELS } from "@/server/modules/sales/schemas";
import {
  cancelDocument,
  confirmOrder,
  convertDocument,
  createDraft,
  postInvoice,
  setQuotationStatus,
  updateDraft,
} from "@/server/modules/sales/service";

const KINDS: Exclude<SalesDocumentKind, "CREDIT_NOTE">[] = ["QUOTATION", "SALES_ORDER", "INVOICE"];

function refreshSales() {
  for (const k of KINDS) revalidatePath(KIND_LABELS[k].path, "layout");
  revalidatePath("/deliveries", "layout");
  revalidatePath("/inventory", "layout");
}

const field = (fd: FormData, name: string) => String(fd.get(name) ?? "");

async function session() {
  const user = await requireUser();
  return { db: getDb(), actor: toActor(user), ctx: await requestContext() };
}

/** Where to go after an invoice was meant to post: posted, or its draft with the reason. */
async function afterQuickPost(r: QuickPostResult): Promise<string> {
  const path = `/invoices/${r.id}`;
  if (r.posted) return `${path}?posted=1`;
  await setFlash(path, r.problem ?? "It couldn't be posted.");
  return path;
}

/**
 * Create a document (no id) or save changes to one (with id and version).
 * Invoices post straight away for people who may post them, unless they chose
 * "Save as draft"; if posting is refused the draft is kept and the reason shown.
 */
export async function saveDraftAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const kind = field(formData, "kind") as Exclude<SalesDocumentKind, "CREDIT_NOTE">;
  let id = field(formData, "id");
  let goTo: string | null = null;
  const result = await toActionResult(async () => {
    if (!KINDS.includes(kind)) throw new ValidationError({ form: ["Unknown document type"] });
    const { db, actor, ctx } = await session();
    const input = formToObject(formData);
    const postNow =
      kind === "INVOICE" && field(formData, "intent") !== "draft" && hasPermission(actor, "invoices.post");
    if (postNow) {
      let r: QuickPostResult;
      if (id) {
        await updateDraft(db, actor, id, input, ctx);
        r = await postDraftNow(db, actor, id, ctx);
      } else {
        r = await createAndPostInvoice(db, actor, input, ctx, {
          idempotencyKey: field(formData, "idempotencyKey") || undefined,
        });
      }
      id = r.id;
      refreshSales();
      goTo = await afterQuickPost(r);
      return r.posted ? `${r.number} posted` : "Saved as a draft: it couldn't be posted";
    }
    if (id) {
      await updateDraft(db, actor, id, input, ctx);
      refreshSales();
      return "Saved";
    }
    const created = await createDraft(db, actor, kind, input, ctx, {
      idempotencyKey: field(formData, "idempotencyKey") || undefined,
    });
    id = created.id;
    refreshSales();
    return created.number ? `${created.number} created` : "Draft invoice created";
  });
  if (result.ok && goTo) redirect(goTo);
  if (result.ok && id) redirect(`${KIND_LABELS[kind].path}/${id}`);
  return result;
}

/** Several customers' invoices from one screen, each posted straight away. */
export async function batchInvoiceAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let results: BatchItemResult[] = [];
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    results = await postInvoiceBatch(db, actor, formToObject(formData), ctx);
    refreshSales();
    const posted = results.filter((r) => r.posted).length;
    const failed = results.length - posted;
    return {
      message:
        failed === 0
          ? `${posted} invoice${posted === 1 ? "" : "s"} posted`
          : `${posted} posted, ${failed} not posted: see below`,
      data: { results: JSON.stringify(results) },
    };
  });
  return result;
}

/**
 * Every button on a document page goes through here, named by `intent`:
 * post, confirm, sent/accepted/declined, to-order, to-invoice, cancel, deliver, share, revoke.
 */
export async function documentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = field(formData, "id");
  const intent = field(formData, "intent");
  let goTo: string | null = null;
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const input = formToObject(formData);
    switch (intent) {
      case "post": {
        const r = await postInvoice(db, actor, id, input, ctx);
        refreshSales();
        goTo = `/invoices/${id}?posted=1`;
        return r.alreadyPosted ? `${r.number} was already posted` : `${r.number} posted`;
      }
      case "confirm": {
        const r = await confirmOrder(db, actor, id, input, ctx);
        refreshSales();
        return r.alreadyConfirmed ? "Already confirmed" : "Order confirmed; stock reserved";
      }
      case "SENT":
      case "ACCEPTED":
      case "DECLINED": {
        await setQuotationStatus(db, actor, id, intent, input, ctx);
        refreshSales();
        return `Marked ${intent.toLowerCase()}`;
      }
      case "to-order":
      case "to-invoice": {
        if (intent === "to-invoice" && hasPermission(actor, "invoices.post")) {
          const q = await invoiceAndPost(db, actor, id, ctx);
          refreshSales();
          goTo = await afterQuickPost(q);
          return q.posted ? `${q.number} posted` : "Invoice saved as a draft: it couldn't be posted";
        }
        // Without posting rights, a draft invoice is made as before.
        const target = intent === "to-order" ? "SALES_ORDER" : "INVOICE";
        const r = await convertDocument(db, actor, id, target, ctx);
        refreshSales();
        goTo = `${KIND_LABELS[r.kind].path}/${r.id}`;
        return r.alreadyConverted ? "Opened the document made earlier" : "Converted";
      }
      case "cancel": {
        await cancelDocument(db, actor, id, input, ctx);
        refreshSales();
        return "Cancelled";
      }
      case "deliver": {
        const r = await createDeliveryNote(db, actor, id, ctx);
        refreshSales();
        goTo = `/deliveries/${r.id}`;
        return `${r.number} ready`;
      }
      case "share": {
        const r = await createShareLink(db, actor, id, ctx);
        revalidatePath(`/invoices/${id}`);
        revalidatePath(`/quotations/${id}`);
        revalidatePath(`/sales-orders/${id}`);
        return { message: "Share link created", data: { token: r.token } };
      }
      case "revoke": {
        await revokeShareLink(db, actor, field(formData, "linkId"), ctx);
        refreshSales();
        return "Link revoked; it no longer opens";
      }
      default:
        throw new ValidationError({ form: ["Unknown action"] });
    }
  });
  if (result.ok && goTo) redirect(goTo);
  return result;
}

export async function deliveryAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = field(formData, "id");
  const intent = field(formData, "intent");
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const input = formToObject(formData);
    if (intent === "dispatch") await dispatchDelivery(db, actor, id, input, ctx);
    else if (intent === "delivered") await markDelivered(db, actor, id, input, ctx);
    else if (intent === "cancel") await cancelDelivery(db, actor, id, input, ctx);
    else throw new ValidationError({ form: ["Unknown action"] });
    revalidatePath("/deliveries", "layout");
    return intent === "dispatch" ? "Dispatched" : intent === "delivered" ? "Delivered" : "Delivery cancelled";
  });
}

export async function taxRateAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    await updateTaxRate(db, actor, formToObject(formData), ctx);
    revalidatePath("/settings/tax");
    return "Tax rate saved. Drafts use it from their next save; posted invoices keep their rate.";
  });
}
