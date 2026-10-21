import type { UserRole } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/errors";

/**
 * Role-based access control.
 *
 * Every server action and route handler checks a permission from this list
 * on the server. Hiding a button in the UI is a convenience, never the control.
 * Each phase adds the permissions for the modules it builds.
 */
export const PERMISSIONS = [
  "settings.view",
  "settings.manage",
  "users.view",
  "users.manage",
  "audit.view",
  "legacy.import",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: ["settings.view", "settings.manage", "users.view", "users.manage", "audit.view", "legacy.import"],
  ACCOUNTANT: ["settings.view", "audit.view"],
  SALES: ["settings.view"],
  STOREKEEPER: ["settings.view"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  ACCOUNTANT: "Accountant",
  SALES: "Sales",
  STOREKEEPER: "Storekeeper",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  OWNER: "Full access, including WhatsApp commands and managing other owners.",
  ADMIN: "Manages settings and users, except owners.",
  ACCOUNTANT: "Payments, accounting and reports.",
  SALES: "Customers, quotations, orders and invoices.",
  STOREKEEPER: "Stock, warehouses and deliveries.",
};

export type Actor = { id: string; email: string; role: UserRole };

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Throws ForbiddenError unless the actor's role grants the permission. */
export function authorize(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) {
    throw new ForbiddenError();
  }
}

/**
 * Rules for changing another user's role or access, apart from the
 * "at least one active owner" rule, which needs a database count and is
 * enforced in the users service.
 */
export function assertCanManageUser(
  actor: Actor,
  target: { id: string; role: UserRole },
  newRole?: UserRole,
): void {
  authorize(actor, "users.manage");
  if (actor.id === target.id) {
    throw new ForbiddenError("You can't change your own role or access. Ask another owner.");
  }
  const touchesOwner = target.role === "OWNER" || newRole === "OWNER";
  if (touchesOwner && actor.role !== "OWNER") {
    throw new ForbiddenError("Only an owner can change an owner, or make someone an owner.");
  }
}
