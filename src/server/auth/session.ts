import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getDb } from "@/server/db/client";
import { ForbiddenError } from "@/server/errors";
import { findUserByAuthId } from "@/server/modules/users/service";

import { authorize, hasPermission, type Actor, type Permission } from "./permissions";
import { resolveSession, type AppUser, type SessionState } from "./resolve";
import { createSupabaseServerClient, isSupabaseConfigured } from "./supabase";

/**
 * The current session, resolved once per request.
 * getClaims() verifies the session token's signature; the database lookup then
 * confirms the account is linked to an active ERP user.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  if (!isSupabaseConfigured()) return { kind: "anonymous" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return { kind: "anonymous" };
  const claims = { sub: String(data.claims.sub), email: (data.claims.email as string | undefined) ?? null };
  return resolveSession(claims, (authUserId) => findUserByAuthId(getDb(), authUserId));
});

/** The signed-in user, or a redirect to the sign-in page. */
export async function requireUser(): Promise<AppUser> {
  const session = await getSession();
  if (session.kind === "user") return session.user;
  if (session.kind === "anonymous") redirect("/login");
  // Signed in at Supabase but not allowed in the ERP: send to sign-in with a reason.
  redirect(`/login?reason=${session.kind}`);
}

/** The signed-in user, who must hold the permission. Throws ForbiddenError otherwise. */
export async function requirePermission(permission: Permission): Promise<AppUser> {
  const user = await requireUser();
  authorize(toActor(user), permission);
  return user;
}

export async function can(permission: Permission): Promise<boolean> {
  const session = await getSession();
  return session.kind === "user" && hasPermission(session.user, permission);
}

export function toActor(user: AppUser): Actor {
  return { id: user.id, email: user.email, role: user.role, permissions: user.permissions };
}

/** IP address and browser for audit records. */
export async function requestContext(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ipAddress: forwarded || h.get("x-real-ip"), userAgent: h.get("user-agent") };
}

export { ForbiddenError };
