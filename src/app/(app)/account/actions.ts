"use server";

import { z } from "zod";

import { toActionResult, type ActionResult } from "@/server/action-result";
import { writeAudit } from "@/server/audit/audit";
import { requestContext, requireUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";
import { ValidationError } from "@/server/errors";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(10, "Use at least 10 characters").max(72, "Use at most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two new passwords don't match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password different from the current one",
  });

export async function changePassword(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
      throw new ValidationError(fieldErrors);
    }

    const supabase = await createSupabaseServerClient();
    // Re-check the current password so an unattended, signed-in screen can't be used to take over the account.
    const check = await supabase.auth.signInWithPassword({
      email: user.email,
      password: parsed.data.currentPassword,
    });
    if (check.error) throw new ValidationError({ currentPassword: ["Current password is incorrect"] });

    const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
    if (error) throw new ValidationError({ newPassword: [error.message] });

    await writeAudit(getDb(), {
      actorUserId: user.id,
      actorLabel: user.email,
      action: "AUTH_PASSWORD_CHANGED",
      entityType: "User",
      entityId: user.id,
      ...(await requestContext()),
    });
    return "Password changed";
  });
}
