"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { createProduct, updateProduct } from "@/server/modules/catalogue/service";

export async function createProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const p = await createProduct(getDb(), toActor(user), formToObject(formData), await requestContext());
    id = p.id;
    revalidatePath("/products");
    return `${p.sku} added`;
  });
  if (result.ok && id) redirect(`/products/${id}`);
  return result;
}

export async function updateProductAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    const p = await updateProduct(getDb(), toActor(user), id, formToObject(formData), await requestContext());
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
    return `${p.sku} saved`;
  });
}
