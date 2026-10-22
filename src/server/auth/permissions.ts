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
  "credit.override", // post past a customer's credit limit, with a reason
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
    "Customers, quotations, sales orders, invoices, deliveries and recording payments. No discounts, reversals or credit overrides.",
  STOREKEEPER:
    "Stock levels, transfers, stock counts, deliveries and receiving goods against purchase orders (posting a count needs an owner or admin).",
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
