"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { applyCredit, deletePayment, recordPayment, reversePayment } from "@/server/modules/payments/service";
import { createCreditNote } from "@/server/modules/sales/credit-notes";

function refresh() {
  for (const p of ["/payments", "/invoices", "/customers", "/credit-notes", "/accounting", "/inventory"]) {
    revalidatePath(p, "layout");
  }
}

async function session() {
  const user = await requireUser();
  return { db: getDb(), actor: toActor(user), ctx: await requestContext() };
}

export async function recordPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await recordPayment(db, actor, formToObject(formData), ctx);
    id = r.id;
    refresh();
    return r.alreadyRecorded ? `${r.number} was already recorded` : `${r.number} recorded`;
  });
  if (result.ok && id) redirect(`/payments/${id}?recorded=1`);
  return result;
}

export async function paymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const input = formToObject(formData);
    if (intent === "reverse") {
      await reversePayment(db, actor, id, input, ctx);
      refresh();
      return "Payment reversed";
    }
    if (intent === "delete") {
      await deletePayment(db, actor, id, input, ctx);
      refresh();
      return "Payment deleted";
    }
    const source =
      String(formData.get("source") ?? "") === "creditNote" ? { creditNoteId: id } : { paymentId: id };
    const applied = await applyCredit(db, actor, source, input, ctx);
    refresh();
    return `KES ${applied} applied`;
  });
}

export async function creditNoteAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await createCreditNote(db, actor, invoiceId, formToObject(formData), ctx);
    id = r.id;
    refresh();
    return `${r.number} issued`;
  });
  if (result.ok && id) redirect(`/credit-notes/${id}?posted=1`);
  return result;
}
