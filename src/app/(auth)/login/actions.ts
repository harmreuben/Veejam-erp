"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAudit } from "@/server/audit/audit";
import { safeNextPath } from "@/server/auth/resolve";
import { requestContext } from "@/server/auth/session";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";
import { findUserByAuthId } from "@/server/modules/users/service";
import { hitLimit, isLimited, LIMITS, minutes } from "@/server/security/rate-limit";

export type SignInState = { error?: string; email?: string };

const signInSchema = z.object({
  email: z.email("Enter a valid email address").transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, "Enter your password"),
  next: z.string().optional(),
});

// One message for every credential failure, so the form never reveals
// whether an email address has an account.
const INVALID = "Email or password is incorrect.";
const DEACTIVATED = "This account has been deactivated. Contact the business owner.";

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  if (!isSupabaseConfigured()) {
    return { error: "Sign-in isn't set up yet. Add the Supabase settings to .env.local." };
  }
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? INVALID, email };

  const db = getDb();
  const ctx = await requestContext();
  // Only failures count, so busy offices signing in normally are never blocked.
  const emailKey = `signin:email:${parsed.data.email}`;
  const ipKey = `signin:ip:${ctx.ipAddress ?? "unknown"}`;
  const [byEmail, byIp] = await Promise.all([
    isLimited(db, emailKey, LIMITS.signInEmail),
    isLimited(db, ipKey, LIMITS.signInIp),
  ]);
  if (!byEmail.allowed || !byIp.allowed) {
    const wait = Math.max(
      byEmail.allowed ? 0 : byEmail.retryAfterSeconds,
      byIp.allowed ? 0 : byIp.retryAfterSeconds,
    );
    return { error: `Too many failed sign-in attempts. Wait ${minutes(wait)} and try again.`, email };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // Supabase reports a ban only after the password checks out, so saying
    // "deactivated" here reveals nothing to someone guessing passwords.
    const banned = error?.code === "user_banned";
    const [emailHit] = await Promise.all([
      hitLimit(db, emailKey, LIMITS.signInEmail),
      hitLimit(db, ipKey, LIMITS.signInIp),
    ]).catch(() => [null]);
    if (emailHit && emailHit.count === LIMITS.signInEmail.limit) {
      await writeAudit(db, {
        actorLabel: parsed.data.email,
        action: "RATE_LIMITED",
        entityType: "Session",
        summary: `Sign-in locked for ${minutes(emailHit.retryAfterSeconds)} after ${emailHit.count} failed attempts`,
        ...ctx,
      }).catch(() => undefined);
    }
    await writeAudit(db, {
      actorLabel: parsed.data.email,
      action: "AUTH_SIGN_IN_FAILED",
      entityType: "Session",
      summary: banned ? "Account deactivated" : "Wrong email or password",
      ...ctx,
    }).catch(() => undefined);
    return { error: banned ? DEACTIVATED : INVALID, email };
  }

  const appUser = await findUserByAuthId(db, data.user.id);
  if (!appUser || !appUser.isActive) {
    await supabase.auth.signOut();
    await writeAudit(db, {
      actorUserId: appUser?.id ?? null,
      actorLabel: parsed.data.email,
      action: "AUTH_SIGN_IN_FAILED",
      entityType: "Session",
      summary: appUser ? "Account deactivated" : "No ERP access granted",
      ...ctx,
    }).catch(() => undefined);
    return {
      error: appUser
        ? DEACTIVATED
        : "This account hasn't been given access to the ERP yet. Ask the owner to grant access.",
      email,
    };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: appUser.id }, data: { lastSeenAt: new Date() } });
    await writeAudit(tx, {
      actorUserId: appUser.id,
      actorLabel: appUser.email,
      action: "AUTH_SIGNED_IN",
      entityType: "Session",
      entityId: appUser.id,
      ...ctx,
    });
  });

  redirect(safeNextPath(parsed.data.next));
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub ? String(data.claims.sub) : null;
    const db = getDb();
    const appUser = sub ? await findUserByAuthId(db, sub) : null;
    await supabase.auth.signOut();
    if (appUser) {
      await writeAudit(db, {
        actorUserId: appUser.id,
        actorLabel: appUser.email,
        action: "AUTH_SIGNED_OUT",
        entityType: "Session",
        entityId: appUser.id,
        ...(await requestContext()),
      }).catch(() => undefined);
    }
  }
  redirect("/login");
}
