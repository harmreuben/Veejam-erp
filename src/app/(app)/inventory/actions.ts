"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { cancelCount, postCount, saveCount, startCount } from "@/server/modules/inventory/counts";
import { postAdjustment, postTransfer } from "@/server/modules/inventory/documents";
import { saveWarehouse } from "@/server/modules/inventory/queries";

const refresh = () => {
  revalidatePath("/inventory", "layout");
  revalidatePath("/products", "layout");
};

export async function postAdjustmentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const r = await postAdjustment(getDb(), toActor(user), formToObject(formData), await requestContext());
    id = r.id;
    refresh();
    return r.alreadyPosted ? `${r.number} was already posted` : `${r.number} posted`;
  });
  if (result.ok && id) redirect(`/inventory/adjustments/${id}`);
  return result;
}

export async function postTransferAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const r = await postTransfer(getDb(), toActor(user), formToObject(formData), await requestContext());
    id = r.id;
    refresh();
    return `${r.number} posted`;
  });
  if (result.ok && id) redirect(`/inventory/transfers/${id}`);
  return result;
}

export async function startCountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const c = await startCount(getDb(), toActor(user), formToObject(formData), await requestContext());
    id = c.id;
    revalidatePath("/inventory/counts");
    return `${c.number} started`;
  });
  if (result.ok && id) redirect(`/inventory/counts/${id}`);
  return result;
}

export async function saveCountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "save");
  let posted = false;
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const db = getDb();
    const actor = toActor(user);
    const saved = await saveCount(db, actor, id, formToObject(formData));
    if (intent === "post") {
      const r = await postCount(db, actor, id, saved.version, await requestContext());
      refresh();
      posted = true;
      return `${r.number} posted`;
    }
    revalidatePath(`/inventory/counts/${id}`);
    return "Counts saved";
  });
  // The page switches to the posted view (and its banner), so go there explicitly.
  if (posted) redirect(`/inventory/counts/${id}?posted=1`);
  return result;
}

export async function cancelCountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    await cancelCount(getDb(), toActor(user), id, await requestContext());
    revalidatePath("/inventory/counts", "layout");
    return "Count cancelled";
  });
}

export async function saveWarehouseAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "") || null;
    const w = await saveWarehouse(getDb(), toActor(user), id, formToObject(formData), await requestContext());
    revalidatePath("/inventory", "layout");
    return `${w.name} saved`;
  });
}
