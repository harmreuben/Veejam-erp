"use server";

import { revalidatePath } from "next/cache";

import { ROLE_LABELS } from "@/server/auth/permissions";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { setSupabaseBan, supabaseAccountHooks } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";
import {
  changeUserRole,
  createStaffAccount,
  roleSchema,
  setUserActive,
  setUserDuties,
} from "@/server/modules/users/service";

export async function addStaff(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const created = await createStaffAccount(
      getDb(),
      toActor(user),
      Object.fromEntries(formData),
      supabaseAccountHooks,
    );
    revalidatePath("/settings/users");
    return `${created.fullName} can now sign in as ${ROLE_LABELS[created.role]}. Give them the temporary password in person.`;
  });
}

export async function updateRole(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const userId = String(formData.get("userId") ?? "");
    const role = roleSchema.parse(formData.get("role"));
    const updated = await changeUserRole(getDb(), toActor(user), userId, role, await requestContext());
    revalidatePath("/settings/users");
    return `${updated.fullName} is now ${ROLE_LABELS[updated.role]}, with that role's standard duties`;
  });
}

export async function updateAccess(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const userId = String(formData.get("userId") ?? "");
    const active = formData.get("active") === "true";
    const updated = await setUserActive(getDb(), toActor(user), userId, active, {
      ...(await requestContext()),
      banHook: setSupabaseBan,
    });
    revalidatePath("/settings/users");
    return active ? `${updated.fullName} can sign in again` : `${updated.fullName} can no longer sign in`;
  });
}

export async function saveDuties(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const userId = String(formData.get("userId") ?? "");
    const r = await setUserDuties(
      getDb(),
      toActor(user),
      { userId, permissions: formData.getAll("permissions").map(String) },
      await requestContext(),
    );
    revalidatePath("/settings/users");
    revalidatePath(`/settings/users/${userId}`);
    if (!r.added.length && !r.removed.length) return "Nothing changed";
    const parts = [
      r.added.length ? `${r.added.length} dut${r.added.length === 1 ? "y" : "ies"} added` : null,
      r.removed.length ? `${r.removed.length} removed` : null,
    ].filter(Boolean);
    return `${r.user.fullName}: ${parts.join(", ")}. It applies from their next click.`;
  });
}
