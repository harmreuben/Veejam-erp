import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { getServerEnv } from "@/config/env";
import { writeAudit } from "@/server/audit/audit";
import type { Db } from "@/server/db/client";
import { hitLimit, LIMITS } from "@/server/security/rate-limit";

import { createSupabaseServerClient } from "./supabase";

type Ctx = { ipAddress?: string | null; userAgent?: string | null };

/** Where the emailed link lands; it then forwards to the new-password page. */
export function resetRedirectUrl(): string {
  return new URL("/auth/confirm?next=/reset-password", getServerEnv().APP_BASE_URL).toString();
}

export type ResetRequestOutcome = "sent" | "no-account" | "limited" | "failed";

/**
 * Ask Supabase to email a password reset link. Only active ERP users get one.
 * The caller always shows the same message whatever happens, so the form never
 * reveals which addresses have accounts. Rate limited per address and per IP.
 */
export async function requestPasswordReset(
  db: Db,
  rawEmail: string,
  ctx: Ctx,
  requestedBy?: { id: string; email: string },
): Promise<ResetRequestOutcome> {
  const email = rawEmail.trim().toLowerCase();
  const [byEmail, byIp] = await Promise.all([
    hitLimit(db, `reset:email:${email}`, LIMITS.resetEmail),
    requestedBy ? null : hitLimit(db, `reset:ip:${ctx.ipAddress ?? "unknown"}`, LIMITS.resetIp),
  ]);
  if (!byEmail.allowed || (byIp && !byIp.allowed)) return "limited";

  const user = await db.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
  const audit = (summary: string) =>
    writeAudit(db, {
      actorUserId: requestedBy?.id ?? null,
      actorLabel: requestedBy?.email ?? email,
      action: "AUTH_PASSWORD_RESET_REQUESTED",
      entityType: "User",
      entityId: user?.id ?? null,
      summary,
      ...ctx,
    }).catch(() => undefined);

  if (!user || !user.isActive) {
    await audit(`Reset asked for ${email}: no active account, nothing sent`);
    return "no-account";
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl() });
  if (error) {
    console.error("Password reset email failed", error.message);
    await audit(`Reset link for ${email} could not be sent: ${error.message}`);
    return "failed";
  }
  await audit(
    requestedBy ? `Reset link sent to ${email} by ${requestedBy.email}` : `Reset link sent to ${email}`,
  );
  return "sent";
}

// ─── Proof that this session came from a reset link ─────────────────
// The new-password page doesn't ask for the old password, so it must only work
// right after a reset link was opened, not for anyone at an unattended,
// signed-in screen. The link handler sets a short-lived cookie tied to that
// session and signed with a server secret; the page and its action check it.

export const RECOVERY_COOKIE = "vj-recovery";
const RECOVERY_MINUTES = 15;

function proofKey(): string {
  const key = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is needed for password resets.");
  return key;
}

const sign = (sessionId: string, expires: number) =>
  createHmac("sha256", proofKey()).update(`recovery:${sessionId}:${expires}`).digest("base64url");

export async function setRecoveryProof(sessionId: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + RECOVERY_MINUTES * 60;
  (await cookies()).set(RECOVERY_COOKIE, `${expires}.${sign(sessionId, expires)}`, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: RECOVERY_MINUTES * 60,
  });
}

export async function hasRecoveryProof(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false;
  const raw = (await cookies()).get(RECOVERY_COOKIE)?.value ?? "";
  const [exp, mac] = raw.split(".");
  const expires = Number(exp);
  if (!mac || !Number.isInteger(expires) || expires * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(sessionId, expires));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function clearRecoveryProof(): Promise<void> {
  (await cookies()).delete(RECOVERY_COOKIE);
}

/** The current Supabase session id (from the verified token), if signed in. */
export async function currentSessionId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const sid = data?.claims?.session_id;
  return typeof sid === "string" ? sid : null;
}
