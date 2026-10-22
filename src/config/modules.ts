import type { Permission } from "@/server/auth/permissions";

/**
 * The ERP modules and the phase in which each one is built.
 * Drives the sidebar. A module is only linked once its phase is complete;
 * until then the sidebar shows it as upcoming instead of a fake page.
 */

export type ModuleGroup = "Sell" | "Stock" | "Money" | "Operate" | "Admin";

export type ErpModule = {
  slug: string;
  name: string;
  group: ModuleGroup;
  phase: number;
  /** Set to the route once the module is actually built. */
  href?: string;
  /** Permission needed to see the link. */
  permission?: Permission;
  /** Shown instead of the phase number, e.g. "5b". */
  phaseLabel?: string;
};

export const ERP_MODULES: readonly ErpModule[] = [
  {
    slug: "dashboard",
    name: "Dashboard",
    group: "Operate",
    phase: 8,
    href: "/dashboard",
    permission: "reports.view",
  },
  {
    slug: "customers",
    name: "Customers",
    group: "Sell",
    phase: 3,
    href: "/customers",
    permission: "customers.view",
  },
  {
    slug: "quotations",
    name: "Quotations",
    group: "Sell",
    phase: 4,
    href: "/quotations",
    permission: "sales.view",
  },
  {
    slug: "sales-orders",
    name: "Sales orders",
    group: "Sell",
    phase: 4,
    href: "/sales-orders",
    permission: "sales.view",
  },
  {
    slug: "invoicing",
    name: "Invoices",
    group: "Sell",
    phase: 4,
    href: "/invoices",
    permission: "sales.view",
  },
  {
    slug: "delivery",
    name: "Deliveries",
    group: "Sell",
    phase: 4,
    href: "/deliveries",
    permission: "sales.view",
  },
  {
    slug: "returns",
    name: "Credit notes",
    group: "Sell",
    phase: 5,
    href: "/credit-notes",
    permission: "sales.view",
  },
  {
    slug: "catalogue",
    name: "Products",
    group: "Stock",
    phase: 3,
    href: "/products",
    permission: "catalogue.view",
  },
  {
    slug: "price-lists",
    name: "Price lists",
    group: "Stock",
    phase: 3,
    href: "/price-lists",
    permission: "catalogue.view",
  },
  {
    slug: "inventory",
    name: "Inventory",
    group: "Stock",
    phase: 3,
    href: "/inventory",
    permission: "inventory.view",
  },
  {
    slug: "suppliers",
    name: "Suppliers",
    group: "Stock",
    phase: 3,
    href: "/suppliers",
    permission: "suppliers.view",
  },
  {
    slug: "purchasing",
    name: "Purchase orders",
    group: "Stock",
    phase: 5,
    href: "/purchase-orders",
    permission: "purchasing.view",
  },
  {
    slug: "goods-received",
    name: "Goods received",
    group: "Stock",
    phase: 5,
    href: "/goods-received",
    permission: "purchasing.view",
  },
  {
    slug: "payments",
    name: "Payments & receipts",
    group: "Money",
    phase: 5,
    href: "/payments",
    permission: "sales.view",
  },
  {
    slug: "balances",
    name: "Customer balances",
    group: "Money",
    phase: 5,
    href: "/payments/balances",
    permission: "customers.view",
  },
  {
    slug: "supplier-bills",
    name: "Supplier bills",
    group: "Money",
    phase: 5,
    href: "/supplier-bills",
    permission: "payables.view",
  },
  {
    slug: "supplier-payments",
    name: "Supplier payments",
    group: "Money",
    phase: 5,
    href: "/supplier-payments",
    permission: "payables.view",
  },
  {
    slug: "accounting",
    name: "Accounting & ledger",
    group: "Money",
    phase: 5,
    href: "/accounting",
    permission: "accounting.view",
  },
  {
    slug: "tax",
    name: "Tax rates",
    group: "Money",
    phase: 4,
    href: "/settings/tax",
    permission: "settings.view",
  },
  {
    slug: "reports",
    name: "Reports",
    group: "Operate",
    phase: 8,
    href: "/reports",
    permission: "reports.view",
  },
  {
    slug: "whatsapp",
    name: "WhatsApp commands",
    group: "Operate",
    phase: 6,
    href: "/whatsapp",
    permission: "whatsapp.view",
  },
  { slug: "audit", name: "Audit log", group: "Admin", phase: 8, href: "/audit", permission: "audit.view" },
  { slug: "imports", name: "Imports", group: "Admin", phase: 3, href: "/imports", permission: "imports.run" },
  {
    slug: "settings",
    name: "Company settings",
    group: "Admin",
    phase: 2,
    href: "/settings/company",
    permission: "settings.view",
  },
  {
    slug: "users",
    name: "Users & roles",
    group: "Admin",
    phase: 2,
    href: "/settings/users",
    permission: "users.view",
  },
  {
    slug: "backups",
    name: "Backup & recovery",
    group: "Admin",
    phase: 8,
    href: "/backups",
    permission: "backups.view",
  },
];

export const MODULE_GROUPS: readonly ModuleGroup[] = ["Sell", "Stock", "Money", "Operate", "Admin"];

export const BUILD_PHASES: readonly { phase: number; title: string }[] = [
  { phase: 1, title: "Project foundation, tooling and documentation" },
  { phase: 2, title: "Database, Prisma schema, sign-in and roles" },
  { phase: 3, title: "Customers, products, SKU import, pricing and inventory" },
  { phase: 4, title: "Quotations, sales orders, invoices, PDFs and stock posting" },
  { phase: 5, title: "Payments, receipts and double-entry accounting" },
  { phase: 6, title: "WhatsApp commands with the mock provider" },
  { phase: 7, title: "Meta WhatsApp Cloud API on a test number" },
  { phase: 8, title: "Reports, audit tools, security hardening and backups" },
  { phase: 9, title: "Production deployment and full workflow test" },
];

/** Which phases are finished. */
export const PHASE_STATUS: Record<number, "done" | "partial" | "todo"> = {
  1: "done",
  2: "done",
  3: "done",
  4: "done",
  5: "done",
  6: "done",
  7: "todo",
  8: "done",
  9: "todo",
};
