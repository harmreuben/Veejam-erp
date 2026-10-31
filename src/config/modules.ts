import type { UserRole } from "@/generated/prisma/enums";
import type { Permission } from "@/server/auth/permissions";

/**
 * The 11 sections of the app's menu (VeeJam v2, Nov 2026; Expenses and
 * Business Funds were dropped from the plan). Each section owns
 * a set of paths: its pages are shown as tabs inside it, and the menu marks the
 * section as current on any of them. A section that isn't built yet has no
 * href and shows as "coming", never as a link to an empty page.
 */

export type SectionIcon =
  | "dashboard"
  | "products"
  | "inventory"
  | "customers"
  | "suppliers"
  | "sales"
  | "invoices"
  | "payments"
  | "reports"
  | "whatsapp"
  | "settings";

export type ErpModule = {
  slug: string;
  name: string;
  icon: SectionIcon;
  /** Set to the route once the section is actually built. */
  href?: string;
  /** Other path prefixes that belong to this section (its tabs). */
  paths?: readonly string[];
  /** Permission needed to see the link; with a list, any one of them is enough. */
  permission?: Permission | readonly Permission[];
  /** For a section not built yet: when it arrives. */
  coming?: string;
};

export const ERP_MODULES: readonly ErpModule[] = [
  {
    slug: "dashboard",
    name: "Dashboard",
    icon: "dashboard",
    href: "/dashboard",
    permission: ["reports.view", "dashboard.own"],
  },
  {
    slug: "products",
    name: "Products",
    icon: "products",
    href: "/products",
    paths: ["/price-lists"],
    permission: "catalogue.view",
  },
  { slug: "inventory", name: "Inventory", icon: "inventory", href: "/inventory", permission: "inventory.view" },
  { slug: "customers", name: "Customers", icon: "customers", href: "/customers", permission: "customers.view" },
  {
    slug: "suppliers",
    name: "Suppliers",
    icon: "suppliers",
    href: "/suppliers",
    paths: ["/stock-purchases", "/supplier-payments"],
    permission: "suppliers.view",
  },
  {
    slug: "sales",
    name: "Sales",
    icon: "sales",
    href: "/sales",
    paths: ["/credit-notes", "/sales-returns"],
    permission: "sales.view",
  },
  {
    slug: "invoices",
    name: "Invoices",
    icon: "invoices",
    href: "/invoices",
    paths: ["/documents"],
    permission: "sales.view",
  },
  { slug: "payments", name: "Payments", icon: "payments", href: "/payments", permission: "sales.view" },
  {
    slug: "reports",
    name: "Financial Reports",
    icon: "reports",
    href: "/reports",
    paths: ["/accounting"],
    permission: ["reports.view", "accounting.view"],
  },
  {
    slug: "whatsapp",
    name: "WhatsApp Assistant",
    icon: "whatsapp",
    href: "/whatsapp",
    permission: "whatsapp.view",
  },
  {
    slug: "settings",
    name: "Settings",
    icon: "settings",
    href: "/settings/company",
    paths: ["/settings", "/audit", "/backups", "/imports", "/account"],
    permission: "settings.view",
  },
];

/** The menu section a page belongs to (for the menu highlight and the breadcrumb). */
export function moduleForPath(pathname: string): ErpModule | undefined {
  // The longest matching prefix wins.
  let best: { m: ErpModule; len: number } | undefined;
  for (const m of ERP_MODULES) {
    for (const p of [m.href, ...(m.paths ?? [])]) {
      if (p && (pathname === p || pathname.startsWith(`${p}/`)) && (!best || p.length > best.len)) {
        best = { m, len: p.length };
      }
    }
  }
  return best?.m;
}

/** Does someone with these duties get this module in their menu? */
export function canSeeModule(m: ErpModule, permissions: readonly Permission[]): boolean {
  if (!m.permission) return true;
  const any = typeof m.permission === "string" ? [m.permission] : m.permission;
  return any.some((p) => permissions.includes(p));
}

/**
 * Where each person lands after signing in: the dashboard if they may see it,
 * otherwise the first of their main working pages (e.g. invoices for sales,
 * stock levels for storekeepers), otherwise any page they can open.
 */
const HOME_ORDER = ["dashboard", "invoices", "inventory", "suppliers", "payments", "customers", "products"];
/** A role's own main page comes before the general order (storekeepers start on stock, not invoices). */
const ROLE_HOME: Partial<Record<UserRole, string>> = { STOREKEEPER: "inventory", SALES: "invoices" };

export function homePathFor(role: UserRole, permissions: readonly Permission[]): string {
  const allowed = (m: ErpModule) => !!m.href && canSeeModule(m, permissions);
  const order = ["dashboard", ...(ROLE_HOME[role] ? [ROLE_HOME[role]] : []), ...HOME_ORDER];
  for (const slug of order) {
    const m = ERP_MODULES.find((x) => x.slug === slug);
    if (m && allowed(m)) return m.href!;
  }
  return ERP_MODULES.find(allowed)?.href ?? "/account";
}
