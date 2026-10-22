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
  // Phase 4
  "sales.view", // see quotations, orders, invoices and delivery notes
  "quotations.manage",
  "orders.manage", // create and confirm sales orders (confirming reserves stock)
  "invoices.manage", // create and edit draft invoices
  "invoices.post", // post an invoice: numbers it and takes the stock out
  "sales.discount", // give line discounts
  "delivery.manage",
  "documents.share", // create links that let customers open a document
  "tax.manage",
  // Phase 5a
  "payments.record", // record money received and apply it to invoices
  "payments.reverse",
  "credit_notes.manage",
  "accounting.view", // chart of accounts, journal, trial balance
  "accounting.journal", // manual journal entries (e.g. expenses)
  "accounting.close", // close the books up to a date
  // Phase 5b
  "purchasing.view", // purchase orders and goods received
  "purchasing.manage", // create, send and cancel purchase orders
  "goods.receive", // post goods received (puts stock in at cost)
  "payables.view", // supplier bills, supplier payments and what's owed to suppliers
  "bills.manage", // enter and cancel supplier bills
  "supplier_payments.manage", // pay suppliers and reverse supplier payments
  "inventory.revalue", // set what stock on hand is worth
  // Phase 6
  "whatsapp.use", // run ERP commands from a linked WhatsApp number (owners only)
  "whatsapp.view", // read the WhatsApp message log
  // Phase 8
  "reports.view", // dashboard and management reports
  "dashboard.own", // a personal dashboard of one's own sales
  "backups.view", // see when backups were taken
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  // WhatsApp commands act with an owner's full authority, so they stay with owners.
  ADMIN: PERMISSIONS.filter((p) => p !== "whatsapp.use"),
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
    "sales.view",
    "invoices.manage",
    "invoices.post",
    "documents.share",
    "payments.record",
    "payments.reverse",
    "credit_notes.manage",
    "accounting.view",
    "accounting.journal",
    "reports.view",
    "purchasing.view",
    "purchasing.manage",
    "goods.receive",
    "payables.view",
    "bills.manage",
    "supplier_payments.manage",
  ],
  SALES: [
    "settings.view",
    "customers.view",
    "customers.manage",
    "catalogue.view",
    "inventory.view",
    "sales.view",
    "quotations.manage",
    "orders.manage",
    "invoices.manage",
    "invoices.post",
    "delivery.manage",
    "documents.share",
    "payments.record",
    "dashboard.own",
  ],
  STOREKEEPER: [
    "settings.view",
    "catalogue.view",
    "suppliers.view",
    "inventory.view",
    "inventory.transfer",
    "inventory.count",
    "sales.view",
    "delivery.manage",
    "purchasing.view",
    "goods.receive",
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
  ACCOUNTANT:
    "Customers and credit limits, invoices, payments and reversals, credit notes, purchasing, supplier bills and payments, the accounts and journals.",
  SALES:
    "Customers, quotations, sales orders, invoices, deliveries, recording payments and their own sales dashboard. No discounts or reversals.",
  STOREKEEPER:
    "Stock levels, transfers, stock counts, deliveries and receiving goods against purchase orders (posting a count needs an owner or admin).",
};

/**
 * A person's duties: their role's defaults, plus any duties an owner or admin
 * switched on or off for them (see users/service.ts setUserDuties).
 * `permissions` is the effective list. Code that builds an actor from a
 * signed-in user always fills it; it falls back to the role's defaults only for
 * scripts and tests that act as a plain role.
 */
export type Actor = { id: string; email: string; role: UserRole; permissions?: readonly Permission[] };

/** Anything that can hold permissions: an Actor or a signed-in AppUser. */
export type PermissionHolder = { role: UserRole; permissions?: readonly Permission[] };

/** What a role grants before any per-person changes. */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** A role's default duties. */
export function permissionsFor(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Does this person hold the permission (role defaults plus their own changes)? */
export function hasPermission(who: PermissionHolder, permission: Permission): boolean {
  return (who.permissions ?? ROLE_PERMISSIONS[who.role]).includes(permission);
}

/** Throws ForbiddenError unless the actor holds the permission. */
export function authorize(actor: PermissionHolder, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError();
  }
}

// ─── Per-person duties ───────────────────────────────────────────────

export const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value);

/**
 * Duties that can't be switched on for someone outside the roles that have
 * them: WhatsApp commands act with an owner's full authority, and managing
 * users is what makes someone an administrator. Change the role instead.
 */
export const NOT_GRANTABLE: readonly Permission[] = ["whatsapp.use", "users.manage"];

/** A duty only makes sense with the one it needs (you can't post invoices you can't see). */
export const REQUIRES: Partial<Record<Permission, Permission>> = {
  "settings.manage": "settings.view",
  "tax.manage": "settings.view",
  "users.manage": "users.view",
  "customers.manage": "customers.view",
  "customers.credit": "customers.view",
  "catalogue.manage": "catalogue.view",
  "catalogue.costs": "catalogue.view",
  "pricing.manage": "catalogue.view",
  "suppliers.manage": "suppliers.view",
  "inventory.adjust": "inventory.view",
  "inventory.transfer": "inventory.view",
  "inventory.count": "inventory.view",
  "inventory.count.post": "inventory.count",
  "inventory.revalue": "inventory.view",
  "warehouses.manage": "inventory.view",
  "quotations.manage": "sales.view",
  "orders.manage": "sales.view",
  "invoices.manage": "sales.view",
  "invoices.post": "invoices.manage",
  "sales.discount": "sales.view",
  "delivery.manage": "sales.view",
  "documents.share": "sales.view",
  "payments.record": "sales.view",
  "payments.reverse": "payments.record",
  "credit_notes.manage": "sales.view",
  "accounting.journal": "accounting.view",
  "accounting.close": "accounting.view",
  "purchasing.manage": "purchasing.view",
  "goods.receive": "purchasing.view",
  "bills.manage": "payables.view",
  "supplier_payments.manage": "payables.view",
  "whatsapp.use": "whatsapp.view",
  "dashboard.own": "sales.view",
};

export type DutyChange = { permission: string; granted: boolean };

/**
 * Effective duties for a role plus per-person changes. Owners always have
 * everything (so the business can never lock itself out). Unknown or
 * ungrantable entries are ignored, and a duty whose prerequisite is missing
 * is dropped, so the result is always consistent.
 */
export function effectivePermissions(role: UserRole, changes: readonly DutyChange[] = []): Permission[] {
  if (role === "OWNER") return [...PERMISSIONS];
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const c of changes) {
    if (!isPermission(c.permission)) continue;
    if (c.granted) {
      if (!NOT_GRANTABLE.includes(c.permission) || roleHasPermission(role, c.permission))
        set.add(c.permission);
    } else set.delete(c.permission);
  }
  // Drop anything whose prerequisite chain is broken (repeat until stable).
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...set]) {
      const need = REQUIRES[p];
      if (need && !set.has(need)) {
        set.delete(p);
        changed = true;
      }
    }
  }
  return PERMISSIONS.filter((p) => set.has(p));
}

export type DutyGroup =
  | "Selling"
  | "Customers"
  | "Payments and credit"
  | "Products and prices"
  | "Stock"
  | "Buying"
  | "Accounts"
  | "Reports and WhatsApp"
  | "Administration";

/** Plain-English names for the duties page. Every permission must be listed (tested). */
export const PERMISSION_INFO: Record<Permission, { group: DutyGroup; label: string }> = {
  "sales.view": { group: "Selling", label: "See quotations, orders, invoices and deliveries" },
  "quotations.manage": { group: "Selling", label: "Write quotations" },
  "orders.manage": { group: "Selling", label: "Take sales orders (reserves stock)" },
  "invoices.manage": { group: "Selling", label: "Prepare draft invoices" },
  "invoices.post": { group: "Selling", label: "Post invoices (takes stock out)" },
  "sales.discount": { group: "Selling", label: "Give discounts" },
  "delivery.manage": { group: "Selling", label: "Dispatch and deliver goods" },
  "documents.share": { group: "Selling", label: "Send customers links to documents" },
  "customers.view": { group: "Customers", label: "See customers" },
  "customers.manage": { group: "Customers", label: "Add and edit customers" },
  "customers.credit": { group: "Customers", label: "Set credit limits and payment terms" },
  "payments.record": { group: "Payments and credit", label: "Record customer payments" },
  "payments.reverse": { group: "Payments and credit", label: "Reverse customer payments" },
  "credit_notes.manage": { group: "Payments and credit", label: "Issue credit notes" },
  "catalogue.view": { group: "Products and prices", label: "See products" },
  "catalogue.manage": { group: "Products and prices", label: "Add and edit products" },
  "catalogue.costs": { group: "Products and prices", label: "See and use cost prices" },
  "pricing.manage": { group: "Products and prices", label: "Change selling prices" },
  "tax.manage": { group: "Products and prices", label: "Change tax rates" },
  "inventory.view": { group: "Stock", label: "See stock levels" },
  "inventory.adjust": { group: "Stock", label: "Adjust stock (gains and write-offs)" },
  "inventory.transfer": { group: "Stock", label: "Move stock between warehouses" },
  "inventory.count": { group: "Stock", label: "Count stock" },
  "inventory.count.post": { group: "Stock", label: "Post stock counts (changes stock)" },
  "inventory.revalue": { group: "Stock", label: "Set what stock is worth" },
  "warehouses.manage": { group: "Stock", label: "Manage warehouses" },
  "suppliers.view": { group: "Buying", label: "See suppliers" },
  "suppliers.manage": { group: "Buying", label: "Add and edit suppliers" },
  "purchasing.view": { group: "Buying", label: "See purchase orders and goods received" },
  "purchasing.manage": { group: "Buying", label: "Raise and cancel purchase orders" },
  "goods.receive": { group: "Buying", label: "Receive goods into stock" },
  "payables.view": { group: "Buying", label: "See supplier bills and what we owe" },
  "bills.manage": { group: "Buying", label: "Enter supplier bills" },
  "supplier_payments.manage": { group: "Buying", label: "Pay suppliers" },
  "accounting.view": { group: "Accounts", label: "See the accounts and ledger" },
  "accounting.journal": { group: "Accounts", label: "Post journal entries" },
  "accounting.close": { group: "Accounts", label: "Start and close the books" },
  "reports.view": { group: "Reports and WhatsApp", label: "See the business dashboard and reports" },
  "dashboard.own": { group: "Reports and WhatsApp", label: "See their own sales dashboard" },
  "whatsapp.view": { group: "Reports and WhatsApp", label: "See the WhatsApp message log" },
  "whatsapp.use": { group: "Reports and WhatsApp", label: "Run ERP commands from WhatsApp" },
  "settings.view": { group: "Administration", label: "See company settings" },
  "settings.manage": { group: "Administration", label: "Change company settings" },
  "users.view": { group: "Administration", label: "See users" },
  "users.manage": { group: "Administration", label: "Add users and change their access" },
  "audit.view": { group: "Administration", label: "See the audit log" },
  "imports.run": { group: "Administration", label: "Import customers and products from files" },
  "legacy.import": { group: "Administration", label: "Import old-system data" },
  "backups.view": { group: "Administration", label: "See backup history" },
};

export const DUTY_GROUPS: readonly DutyGroup[] = [
  "Selling",
  "Customers",
  "Payments and credit",
  "Products and prices",
  "Stock",
  "Buying",
  "Accounts",
  "Reports and WhatsApp",
  "Administration",
];

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
