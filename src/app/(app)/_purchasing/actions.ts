"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { recordSupplierPayment, reverseSupplierPayment } from "@/server/modules/purchasing/payables";
import { describePurchase, recordStockPurchase } from "@/server/modules/purchasing/stock-purchase";
import { revalueStock } from "@/server/modules/purchasing/valuation";

function refresh() {
  for (const p of [
    "/stock-purchases",
    "/supplier-payments",
    "/suppliers",
    "/inventory",
    "/products",
    "/accounting",
    "/reports",
    "/dashboard",
  ]) {
    revalidatePath(p, "layout");
  }
}

async function session() {
  const user = await requireUser();
  return { db: getDb(), actor: toActor(user), ctx: await requestContext() };
}

export async function recordSupplierPaymentAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await recordSupplierPayment(db, actor, formToObject(formData), ctx);
    id = r.id;
    refresh();
    return `${r.number} recorded`;
  });
  if (result.ok && id) redirect(`/supplier-payments/${id}?recorded=1`);
  return result;
}

export async function supplierPaymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    await reverseSupplierPayment(db, actor, id, formToObject(formData), ctx);
    refresh();
    return "Payment reversed";
  });
}

export async function revalueStockAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await revalueStock(db, actor, formToObject(formData), ctx);
    refresh();
    return `${r.number}: stock now valued at KES ${r.value}`;
  });
}

export async function stockPurchaseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await recordStockPurchase(db, actor, formToObject(formData), ctx);
    id = r.id;
    refresh();
    return describePurchase(r);
  });
  if (result.ok && id) redirect(`/stock-purchases/${id}?recorded=1`);
  return result;
}
