import "server-only";

import { z } from "zod";

import type { User } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import { assertCanManageUser, authorize, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";

export type UserSummary = Pick<
  User,
  "id" | "email" | "fullName" | "phone" | "role" | "isActive" | "deactivatedAt" | "lastSeenAt" | "createdAt"
>;

const userSummarySelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  isActive: true,
  deactivatedAt: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

export const roleSchema = z.enum(UserRole);

export const grantAccessSchema = z.object({
  authUserId: z.uuid(),
  email: z.email().transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(2, "Enter the person's name").max(120),
  role: roleSchema,
});

type AuditContext = { ipAddress?: string | null; userAgent?: string | null };

/** Optional hook to block or unblock sign-in at Supabase Auth as well. */
export type AuthBanHook = (authUserId: string, banned: boolean) => Promise<void>;

export async function listUsers(db: Db, actor: Actor): Promise<UserSummary[]> {
  authorize(actor, "users.view");
  return db.user.findMany({
    select: userSummarySelect,
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { fullName: "asc" }],
  });
}

/** Look up the ERP user for a Supabase account. Used on every request. */
export function findUserByAuthId(db: Db, authUserId: string) {
  return db.user.findUnique({
    where: { authUserId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
}

/**
 * Give a Supabase account access to the ERP with a role.
 * Used by the `npm run user:grant` command (run by whoever administers the
 * server) and later by the Users page. Re-running it updates the name and role.
 */
export async function grantUserAccess(
  db: Db,
  input: unknown,
  actor: { id: string | null; label: string },
): Promise<UserSummary> {
  const parsed = grantAccessSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), [i.message]])),
    );
  }
  const { authUserId, email, fullName, role } = parsed.data;

  return db.$transaction(async (tx) => {
    const sameEmail = await tx.user.findUnique({ where: { email } });
    if (sameEmail && sameEmail.authUserId !== authUserId) {
      throw new ConflictError(`${email} is already linked to a different sign-in account.`);
    }
    const existing = await tx.user.findUnique({ where: { authUserId } });
    const user = await tx.user.upsert({
      where: { authUserId },
      create: { authUserId, email, fullName, role },
      update: { email, fullName, role, isActive: true, deactivatedAt: null },
      select: userSummarySelect,
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.label,
      action: "USER_ACCESS_GRANTED",
      entityType: "User",
      entityId: user.id,
      summary: `${email} granted ${role}`,
      before: existing ? { role: existing.role, isActive: existing.isActive } : undefined,
      after: { role, isActive: true },
    });
    return user;
  });
}

export const createStaffSchema = z.object({
  email: z.email("Enter a valid email address").transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(2, "Enter the person's name").max(120),
  role: roleSchema,
  temporaryPassword: z.string().min(10, "Use at least 10 characters").max(72, "Use at most 72 characters"),
});

/** Creates a Supabase sign-in account and returns its id; deletes it on rollback. */
export type AuthAccountHooks = {
  createAccount: (email: string, password: string) => Promise<string>;
  deleteAccount: (authUserId: string) => Promise<void>;
};

/**
 * Add a staff member from the Users page: creates their Supabase sign-in with a
 * temporary password (shared with them in person) and links it to a role.
 * No email is sent. If linking fails, the new sign-in account is removed again.
 */
export async function createStaffAccount(
  db: Db,
  actor: Actor,
  input: unknown,
  hooks: AuthAccountHooks,
): Promise<UserSummary> {
  authorize(actor, "users.manage");
  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues)
      (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
    throw new ValidationError(fieldErrors);
  }
  const { email, fullName, role, temporaryPassword } = parsed.data;
  if (role === "OWNER" && actor.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can add another owner.");
  }
  if (await db.user.findUnique({ where: { email } })) {
    throw new ValidationError({ email: ["Someone with this email already has access."] });
  }

  const authUserId = await hooks.createAccount(email, temporaryPassword);
  try {
    return await grantUserAccess(
      db,
      { authUserId, email, fullName, role },
      { id: actor.id, label: actor.email },
    );
  } catch (error) {
    await hooks.deleteAccount(authUserId).catch(() => undefined);
    throw error;
  }
}

/** Lock active owners (FOR UPDATE) and fail if the change would leave none. */
async function assertAnotherActiveOwner(tx: DbOrTx, excludingUserId: string): Promise<void> {
  const owners = await tx.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM users WHERE role = 'OWNER' AND is_active = true FOR UPDATE`;
  if (!owners.some((o) => o.id !== excludingUserId)) {
    throw new ConflictError("VeeJam must always have at least one active owner.");
  }
}

export async function changeUserRole(
  db: Db,
  actor: Actor,
  userId: string,
  newRoleInput: unknown,
  context: AuditContext = {},
): Promise<UserSummary> {
  const newRole = roleSchema.parse(newRoleInput);
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundError("That user no longer exists.");
    assertCanManageUser(actor, target, newRole);
    if (target.role === newRole) return pick(target);
    if (target.role === "OWNER" && target.isActive) await assertAnotherActiveOwner(tx, target.id);

    const updated = await tx.user.update({
      where: { id: userId },
      data: { role: newRole },
      select: userSummarySelect,
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "USER_ROLE_CHANGED",
      entityType: "User",
      entityId: userId,
      summary: `${target.email}: ${target.role} → ${newRole}`,
      before: { role: target.role },
      after: { role: newRole },
      ...context,
    });
    return updated;
  });
}

/**
 * Deactivate or reactivate a user. Deactivation takes effect on the user's very
 * next request, because every request re-checks `is_active` in the database.
 */
export async function setUserActive(
  db: Db,
  actor: Actor,
  userId: string,
  active: boolean,
  options: AuditContext & { banHook?: AuthBanHook } = {},
): Promise<UserSummary> {
  const { banHook, ...context } = options;
  const result = await db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundError("That user no longer exists.");
    assertCanManageUser(actor, target);
    if (target.isActive === active)
      return { user: pick(target), authUserId: target.authUserId, changed: false };
    if (!active && target.role === "OWNER") await assertAnotherActiveOwner(tx, target.id);

    const updated = await tx.user.update({
      where: { id: userId },
      data: { isActive: active, deactivatedAt: active ? null : new Date() },
      select: userSummarySelect,
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
      entityType: "User",
      entityId: userId,
      summary: `${target.email} ${active ? "reactivated" : "deactivated"}`,
      before: { isActive: target.isActive },
      after: { isActive: active },
      ...context,
    });
    return { user: updated, authUserId: target.authUserId, changed: true };
  });

  // Best effort, after commit: also block sign-in at Supabase. Access is already
  // removed by the database flag, so a failure here does not reopen access.
  if (result.changed && banHook) {
    try {
      await banHook(result.authUserId, !active);
    } catch (error) {
      console.error("Supabase ban update failed for user", userId, (error as Error).message);
    }
  }
  return result.user;
}

function pick(u: User): UserSummary {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    deactivatedAt: u.deactivatedAt,
    lastSeenAt: u.lastSeenAt,
    createdAt: u.createdAt,
  };
}
