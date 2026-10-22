"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAudit } from "@/server/audit/audit";
import { clearRecoveryProof, currentSessionId, hasRecoveryProof } from "@/server/auth/password-reset";
import { getSession, requestContext } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";

export type ResetState = { errors?: Record<string, string[]>; error?: string };

const schema = z
  .object({
    newPassword: z.string().min(10, "Use at least 10 characters").max(72, "Use at most 72 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two passwords don't match",
  });

export async function setNewPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  // Only straight after opening a reset link (see password-reset.ts).
  if (!(await hasRecoveryProof(await currentSessionId()))) {
    return { error: "This reset has expired. Ask for a new link." };
  }
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const errors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (errors[String(i.path[0])] ??= []).push(i.message);
    return { errors };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) {
    return {
      errors: {
        newPassword: [
          error.code === "same_password" ? "Choose a password different from the old one." : error.message,
        ],
      },
    };
  }
  // Anyone else still signed in as this person (e.g. whoever knew the old password) is signed out.
  await supabase.auth.signOut({ scope: "others" });
  await clearRecoveryProof();

  const session = await getSession();
  if (session.kind === "user") {
    await writeAudit(getDb(), {
      actorUserId: session.user.id,
      actorLabel: session.user.email,
      action: "AUTH_PASSWORD_RESET_COMPLETED",
      entityType: "User",
      entityId: session.user.id,
      summary: "New password set from a reset link; other sessions signed out",
      ...(await requestContext()),
    }).catch(() => undefined);
    redirect("/");
  }
  // A sign-in account without ERP access: sign out and explain.
  await supabase.auth.signOut();
  redirect("/login?reason=reset");
}
