"use server";

import { revalidatePath } from "next/cache";

import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { updateCompanySettings } from "@/server/modules/settings/service";

export async function saveCompanySettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const input = Object.fromEntries(formData);
    await updateCompanySettings(getDb(), toActor(user), input, await requestContext());
    revalidatePath("/", "layout");
    return "Company settings saved";
  });
}
