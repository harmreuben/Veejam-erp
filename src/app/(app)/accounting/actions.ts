"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import {
  closeBooks,
  createAccount,
  postManualJournal,
  startAccounting,
} from "@/server/modules/accounting/service";

async function session() {
  const user = await requireUser();
  return { db: getDb(), actor: toActor(user), ctx: await requestContext() };
}

export async function startAccountingAction(): Promise<ActionResult> {
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const r = await startAccounting(db, actor, ctx);
    revalidatePath("/accounting", "layout");
    return [
      r.openingNumber
        ? `Opening balances posted (${r.openingNumber})`
        : "Opening balances were already posted",
      r.backfilled ? `${r.backfilled} earlier invoice(s) added to the journal` : null,
    ]
      .filter(Boolean)
      .join(". ");
  });
}

export async function manualJournalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const e = await postManualJournal(db, actor, formToObject(formData), ctx);
    id = e.id;
    revalidatePath("/accounting", "layout");
    return `${e.number} posted`;
  });
  if (result.ok && id) redirect(`/accounting/journal/${id}`);
  return result;
}

export async function closeBooksAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    await closeBooks(db, actor, formToObject(formData), ctx);
    revalidatePath("/accounting", "layout");
    return "Saved";
  });
}

export async function createAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const { db, actor, ctx } = await session();
    const a = await createAccount(db, actor, formToObject(formData), ctx);
    revalidatePath("/accounting", "layout");
    return `${a.code} ${a.name} added`;
  });
}
