import "server-only";

import { z } from "zod";

import type { User } from "@/generated/prisma/client";
import { UserRole } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import {
  assertCanManageUser,
  authorize,
  effectivePermissions,
  isPermission,
  NOT_GRANTABLE,
  PERMISSION_INFO,
  permissionsFor,
  REQUIRES,
  roleHasPermission,
  type Actor,
  type Permission,
} from "@/server/auth/permissions";
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

export async function listUsers(
  db: Db,
  actor: Actor,
): Promise<(UserSummary & { dutiesAdded: number; dutiesRemoved: number })[]> {
  authorize(actor, "users.view");
  const users = await db.user.findMany({
    select: { ...userSummarySelect, dutyChanges: { select: { permission: true, granted: true } } },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { fullName: "asc" }],
  });
  return users.map(({ dutyChanges, ...u }) => {
    // Count what actually differs from the role (owners ignore changes).
    const effective = new Set(effectivePermissions(u.role, dutyChanges));
    const defaults = new Set(permissionsFor(u.role));
    return {
      ...u,
      dutiesAdded: [...effective].filter((p) => !defaults.has(p)).length,
      dutiesRemoved: [...defaults].filter((p) => !effective.has(p)).length,
    };
  });
}

/** Look up the ERP user for a Supabase account. Used on every request. */
export function findUserByAuthId(db: Db, authUserId: string) {
  return db.user.findUnique({
    where: { authUserId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      dutyChanges: { select: { permission: true, granted: true } },
    },
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

    // A new role starts from its own defaults: changes made for the old role no longer apply.
    const cleared = await tx.userDutyChange.deleteMany({ where: { userId } });
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
      metadata: cleared.count ? { dutyChangesCleared: cleared.count } : undefined,
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

// ─── Duties (per-person permissions) ───────────────────────────────

export type DutiesView = {
  user: UserSummary;
  /** What the person can do now. */
  effective: Permission[];
  /** What their role gives by default. */
  roleDefaults: Permission[];
  /** Whether the viewer may change them, and why not if they can't. */
  editable: boolean;
  readOnlyReason: string | null;
};

/** One person's duties, for the duties page. */
export async function getUserDuties(db: Db, actor: Actor, userId: string): Promise<DutiesView> {
  authorize(actor, "users.view");
  const target = await db.user.findUnique({
    where: { id: userId },
    include: { dutyChanges: { select: { permission: true, granted: true } } },
  });
  if (!target) throw new NotFoundError("That user no longer exists.");
  let readOnlyReason: string | null = null;
  try {
    assertCanManageUser(actor, target);
  } catch (error) {
    readOnlyReason =
      error instanceof ForbiddenError ? error.message : "You can't change this person's duties.";
  }
  if (!readOnlyReason && target.role === "OWNER") readOnlyReason = "Owners always have every duty.";
  if (!readOnlyReason && !target.isActive) readOnlyReason = "Reactivate this person to change their duties.";
  return {
    user: pick(target),
    effective: effectivePermissions(target.role, target.dutyChanges),
    roleDefaults: [...permissionsFor(target.role)],
    editable: readOnlyReason === null,
    readOnlyReason,
  };
}

export const dutiesSchema = z.object({
  userId: z.uuid(),
  /** The full list of duties the person should have (the ticked boxes). */
  permissions: z.array(z.string()).max(200),
});

/**
 * Set exactly which duties a person has. Stored as changes from their role's
 * defaults, so a later change to a role's defaults still reaches everyone who
 * wasn't customised for that duty.
 *
 * Rules: owners and admins only (admins can't touch owners); not your own;
 * owners always keep every duty; WhatsApp commands and managing users can't be
 * switched on outside the roles that have them; a duty needs the duty it
 * depends on (e.g. posting invoices needs preparing them).
 */
export async function setUserDuties(
  db: Db,
  actor: Actor,
  input: unknown,
  context: AuditContext = {},
): Promise<{ user: UserSummary; added: Permission[]; removed: Permission[] }> {
  const parsed = dutiesSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError({ permissions: ["Choose the duties again."] });
  const unknown = parsed.data.permissions.filter((p) => !isPermission(p));
  if (unknown.length) throw new ValidationError({ permissions: [`Unknown duty: ${unknown.join(", ")}`] });
  const wanted = new Set(parsed.data.permissions as Permission[]);

  return db.$transaction(async (tx) => {
    // Lock the person so two people editing at once apply one after the other.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${parsed.data.userId}::uuid FOR UPDATE`;
    const target = await tx.user.findUnique({
      where: { id: parsed.data.userId },
      include: { dutyChanges: true },
    });
    if (!target) throw new NotFoundError("That user no longer exists.");
    assertCanManageUser(actor, target);
    if (target.role === "OWNER") throw new ConflictError("Owners always have every duty.");
    if (!target.isActive) throw new ConflictError("Reactivate this person before changing their duties.");

    const problems: string[] = [];
    for (const p of wanted) {
      if (NOT_GRANTABLE.includes(p) && !roleHasPermission(target.role, p)) {
        problems.push(`"${PERMISSION_INFO[p].label}" comes only with a role. Change their role instead.`);
      }
      const need = REQUIRES[p];
      if (need && !wanted.has(need)) {
        problems.push(`"${PERMISSION_INFO[p].label}" also needs "${PERMISSION_INFO[need].label}".`);
      }
    }
    if (problems.length) throw new ValidationError({ permissions: problems });

    const defaults = new Set(permissionsFor(target.role));
    const changes = [
      ...[...wanted].filter((p) => !defaults.has(p)).map((permission) => ({ permission, granted: true })),
      ...[...defaults].filter((p) => !wanted.has(p)).map((permission) => ({ permission, granted: false })),
    ];
    const before = effectivePermissions(target.role, target.dutyChanges);
    const after = effectivePermissions(target.role, changes);
    const added = after.filter((p) => !before.includes(p));
    const removed = before.filter((p) => !after.includes(p));
    if (!added.length && !removed.length) return { user: pick(target), added, removed };

    await tx.userDutyChange.deleteMany({ where: { userId: target.id } });
    if (changes.length) {
      await tx.userDutyChange.createMany({ data: changes.map((c) => ({ userId: target.id, ...c })) });
    }
    const label = (ps: Permission[]) => ps.map((p) => PERMISSION_INFO[p].label).join("; ");
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "USER_DUTIES_CHANGED",
      entityType: "User",
      entityId: target.id,
      summary: [
        `${target.email}:`,
        added.length ? `added ${label(added)}` : null,
        removed.length ? `${added.length ? "; " : ""}removed ${label(removed)}` : null,
      ]
        .filter(Boolean)
        .join(" "),
      before: { permissions: before },
      after: { permissions: after },
      metadata: { role: target.role, changesFromRole: changes },
      ...context,
    });
    return { user: pick(target), added, removed };
  });
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
