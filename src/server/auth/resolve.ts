import type { UserRole } from "@/generated/prisma/enums";

import { effectivePermissions, type DutyChange, type Permission } from "./permissions";

/**
 * Pure session logic, separated from Supabase and the database so it can be tested.
 *
 * A Supabase account alone is not enough to use the ERP: it must be linked
 * to an active row in the `users` table, which carries the role.
 */

export type AppUser = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  /** Effective duties: the role's defaults plus this person's own changes. */
  permissions: readonly Permission[];
};

export type SessionState =
  | { kind: "anonymous" }
  | { kind: "no-access"; email: string | null }
  | { kind: "deactivated"; email: string }
  | { kind: "user"; user: AppUser };

export type VerifiedClaims = { sub: string; email?: string | null } | null;

export type UserLookup = (authUserId: string) => Promise<{
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  dutyChanges?: DutyChange[];
} | null>;

export async function resolveSession(claims: VerifiedClaims, lookup: UserLookup): Promise<SessionState> {
  if (!claims?.sub) return { kind: "anonymous" };
  const row = await lookup(claims.sub);
  if (!row) return { kind: "no-access", email: claims.email ?? null };
  if (!row.isActive) return { kind: "deactivated", email: row.email };
  return {
    kind: "user",
    user: {
      id: row.id,
      email: row.email,
      fullName: row.fullName,
      role: row.role,
      permissions: effectivePermissions(row.role, row.dutyChanges ?? []),
    },
  };
}

/** Paths reachable without signing in. Everything else requires a session. */
/** "/d/…" is a customer's share link: the token itself is the permission (see sales/extras.ts). */
const PUBLIC_PATHS = [
  "/login",
  "/api/health",
  "/api/whatsapp/webhook",
  "/d",
  // Installable web app: browsers fetch these without the session cookie.
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Where to go after signing in. Only same-site relative paths are allowed,
 * so a crafted link like /login?next=https://evil.example can't redirect users away.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (next.startsWith("/login")) return "/";
  try {
    const url = new URL(next, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}
