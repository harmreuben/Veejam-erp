"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { createCustomer, updateCustomer } from "@/server/modules/customers/service";

export async function createCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const c = await createCustomer(getDb(), toActor(user), formToObject(formData), await requestContext());
    id = c.id;
    revalidatePath("/customers");
    return `${c.code} ${c.name} added`;
  });
  if (result.ok && id) redirect(`/customers/${id}?created=1`);
  return result;
}

export async function updateCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    const c = await updateCustomer(
      getDb(),
      toActor(user),
      id,
      formToObject(formData),
      await requestContext(),
    );
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return `${c.name} saved`;
  });
}
