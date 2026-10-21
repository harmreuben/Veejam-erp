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
  // Phase 3
  "customers.view",
  "customers.manage",
  "customers.credit", // credit limit and payment terms
  "catalogue.view",
  "catalogue.manage",
  "catalogue.costs", // see and edit cost prices
  "pricing.manage",
  "suppliers.view",
  "suppliers.manage",
  "inventory.view",
  "inventory.adjust", // post stock adjustments (gains and write-offs)
  "inventory.transfer",
  "inventory.count", // start counts and enter counted quantities
  "inventory.count.post", // post a count, which changes stock
  "warehouses.manage",
  "imports.run",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  ADMIN: PERMISSIONS,
  ACCOUNTANT: [
    "settings.view",
    "audit.view",
    "customers.view",
    "customers.manage",
    "customers.credit",
    "catalogue.view",
    "catalogue.costs",
    "suppliers.view",
    "suppliers.manage",
    "inventory.view",
  ],
  SALES: ["settings.view", "customers.view", "customers.manage", "catalogue.view", "inventory.view"],
  STOREKEEPER: [
    "settings.view",
    "catalogue.view",
    "suppliers.view",
    "inventory.view",
    "inventory.transfer",
    "inventory.count",
  ],
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
  ADMIN: "Everything except managing owners.",
  ACCOUNTANT: "Customers and credit limits, suppliers, costs; payments and accounting from Phase 5.",
  SALES: "Customers and the product list; quotations, orders and invoices from Phase 4.",
  STOREKEEPER: "Stock levels, transfers and stock counts (posting a count needs an owner or admin).",
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
