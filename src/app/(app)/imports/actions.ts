"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ImportKind } from "@/generated/prisma/enums";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { cancelImport, commitImport, validateImport } from "@/server/modules/imports/service";

export async function uploadImportAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const kind = String(formData.get("kind") ?? "");
    const file = formData.get("file");
    if (!(kind in ImportKind)) throw new ValidationError({ kind: ["Choose what you're importing"] });
    if (!(file instanceof File) || file.size === 0)
      throw new ValidationError({ file: ["Choose a CSV file"] });
    const job = await validateImport(
      getDb(),
      toActor(user),
      kind as ImportKind,
      file.name,
      Buffer.from(await file.arrayBuffer()),
      await requestContext(),
    );
    id = job.id;
    revalidatePath("/imports");
    return "File checked";
  });
  if (result.ok && id) redirect(`/imports/${id}`);
  return result;
}

export async function commitImportAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    const s = await commitImport(getDb(), toActor(user), id, await requestContext());
    revalidatePath("/", "layout");
    return `Imported: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged`;
  });
}

export async function cancelImportAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    await cancelImport(getDb(), toActor(user), id, await requestContext());
    revalidatePath("/imports", "layout");
    return "Import cancelled; nothing was written";
  });
}
