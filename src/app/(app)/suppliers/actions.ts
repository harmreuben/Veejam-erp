"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { createSupplier, updateSupplier } from "@/server/modules/suppliers/service";

export async function createSupplierAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const s = await createSupplier(getDb(), toActor(user), formToObject(formData), await requestContext());
    id = s.id;
    revalidatePath("/suppliers");
    return `${s.code} ${s.name} added`;
  });
  if (result.ok && id) redirect(`/suppliers/${id}`);
  return result;
}

export async function updateSupplierAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    const s = await updateSupplier(
      getDb(),
      toActor(user),
      id,
      formToObject(formData),
      await requestContext(),
    );
    revalidatePath("/suppliers");
    revalidatePath(`/suppliers/${id}`);
    return `${s.name} saved`;
  });
}
