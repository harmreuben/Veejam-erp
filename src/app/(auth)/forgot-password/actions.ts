"use server";

import { z } from "zod";

import { requestPasswordReset } from "@/server/auth/password-reset";
import { requestContext } from "@/server/auth/session";
import { isSupabaseConfigured } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";
import { minutes } from "@/server/security/rate-limit";

export type ForgotState = { sentTo?: string; error?: string; email?: string };

const schema = z.object({ email: z.email("Enter a valid email address") });

export async function askForResetLink(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  if (!isSupabaseConfigured()) return { error: "Sign-in isn't set up yet." };
  const email = String(formData.get("email") ?? "").trim();
  const parsed = schema.safeParse({ email });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, email };
  const outcome = await requestPasswordReset(getDb(), parsed.data.email, await requestContext());
  if (outcome === "limited") {
    return { error: `Too many reset requests. Wait about ${minutes(3600)} and try again.`, email };
  }
  // The same answer whether or not the address has an account.
  return { sentTo: parsed.data.email.toLowerCase() };
}
