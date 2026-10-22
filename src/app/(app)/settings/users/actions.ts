"use server";

import { revalidatePath } from "next/cache";

import { ROLE_LABELS } from "@/server/auth/permissions";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestPasswordReset } from "@/server/auth/password-reset";
import { assertCanManageUser } from "@/server/auth/permissions";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { setSupabaseBan, supabaseAccountHooks } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";
import { ConflictError } from "@/server/errors";
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

/** Email someone a password reset link (they choose the new password themselves). */
export async function sendResetLink(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const me = await requireUser();
    const db = getDb();
    const target = await db.user.findUnique({ where: { id: String(formData.get("userId") ?? "") } });
    if (!target) throw new ConflictError("That user no longer exists.");
    assertCanManageUser(toActor(me), target);
    const outcome = await requestPasswordReset(db, target.email, await requestContext(), {
      id: me.id,
      email: me.email,
    });
    if (outcome === "limited")
      throw new ConflictError("Three links were sent in the last hour. Wait a while.");
    if (outcome === "failed") {
      throw new ConflictError(
        "The email couldn't be sent. Check the email settings in Supabase (see docs/DEPLOYMENT.md).",
      );
    }
    if (outcome === "no-account") throw new ConflictError(`${target.fullName} is deactivated.`);
    return `Reset link emailed to ${target.email}. It works once, for one hour.`;
  });
}
