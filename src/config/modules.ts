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
};

export const ERP_MODULES: readonly ErpModule[] = [
  { slug: "dashboard", name: "Dashboard", group: "Operate", phase: 8 },
  { slug: "customers", name: "Customers", group: "Sell", phase: 3 },
  { slug: "quotations", name: "Quotations", group: "Sell", phase: 4 },
  { slug: "sales-orders", name: "Sales orders", group: "Sell", phase: 4 },
  { slug: "invoicing", name: "Invoices", group: "Sell", phase: 4 },
  { slug: "returns", name: "Returns & credit notes", group: "Sell", phase: 5 },
  { slug: "delivery", name: "Delivery & dispatch", group: "Sell", phase: 4 },
  { slug: "catalogue", name: "Products & SKUs", group: "Stock", phase: 3 },
  { slug: "inventory", name: "Inventory & warehouses", group: "Stock", phase: 3 },
  { slug: "suppliers", name: "Suppliers & purchasing", group: "Stock", phase: 3 },
  { slug: "payments", name: "Payments & receipts", group: "Money", phase: 5 },
  { slug: "accounting", name: "Accounting & ledger", group: "Money", phase: 5 },
  { slug: "tax", name: "Tax settings", group: "Money", phase: 5 },
  { slug: "reports", name: "Reports", group: "Operate", phase: 8 },
  { slug: "whatsapp", name: "WhatsApp commands", group: "Operate", phase: 6 },
  { slug: "audit", name: "Audit log", group: "Admin", phase: 8 },
  { slug: "settings", name: "Company settings", group: "Admin", phase: 2 },
  { slug: "users", name: "Users & permissions", group: "Admin", phase: 2 },
  { slug: "backups", name: "Backup & recovery", group: "Admin", phase: 8 },
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

export const CURRENT_PHASE = 1;
