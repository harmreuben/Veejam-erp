"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import {
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  markOrdered,
  updatePurchaseOrder,
} from "@/server/modules/purchasing/orders";
import {
  cancelSupplierBill,
  postSupplierBill,
  recordSupplierPayment,
  reverseSupplierPayment,
} from "@/server/modules/purchasing/payables";
import { postGoodsReceipt } from "@/server/modules/purchasing/receipts";
import { revalueStock } from "@/server/modules/purchasing/valuation";

function refresh() {
  for (const p of [
    "/purchase-orders",
    "/goods-received",
    "/supplier-bills",
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

export async function savePurchaseOrderAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const existingId = String(formData.get("id") ?? "");
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const input = formToObject(formData);
    const r = existingId
      ? await updatePurchaseOrder(db, actor, existingId, input, ctx)
      : await createPurchaseOrder(db, actor, input, ctx);
    id = r.id;
    refresh();
    return `${r.number} saved`;
  });
  if (result.ok && id) redirect(`/purchase-orders/${id}?saved=1`);
  return result;
}

export async function purchaseOrderAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const version = Number(formData.get("version") ?? 0);
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const input = formToObject(formData);
    let message: string;
    if (intent === "order")
      message = `${(await markOrdered(db, actor, id, version, ctx)).number} marked as ordered`;
    else if (intent === "cancel")
      message = `${(await cancelPurchaseOrder(db, actor, id, input, ctx)).number} cancelled`;
    else if (intent === "close")
      message = `${(await closePurchaseOrder(db, actor, id, input, ctx)).number} closed`;
    else throw new Error("Unknown action");
    refresh();
    return message;
  });
}

export async function receiveGoodsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  let mixed = false;
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await postGoodsReceipt(db, actor, formToObject(formData), ctx);
    id = r.id;
    mixed = Boolean(r.uncosted?.length);
    refresh();
    return r.alreadyPosted ? `${r.number} was already posted` : `${r.number} posted`;
  });
  if (result.ok && id) redirect(`/goods-received/${id}?posted=1${mixed ? "&uncosted=1" : ""}`);
  return result;
}

export async function postBillAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await postSupplierBill(db, actor, formToObject(formData), ctx);
    id = r.id;
    refresh();
    return `${r.number} entered`;
  });
  if (result.ok && id) redirect(`/supplier-bills/${id}?posted=1`);
  return result;
}

export async function billAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await cancelSupplierBill(db, actor, id, formToObject(formData), ctx);
    refresh();
    return `${r.number} cancelled`;
  });
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
