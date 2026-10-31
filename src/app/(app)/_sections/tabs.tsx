import type { ReactNode } from "react";

import { Tabs } from "@/components/tabs";

/*
 * The tabs inside each of the 13 menu sections (see src/config/modules.ts).
 * Pages that belong together live under one section and switch with these tabs.
 */

function SectionTabs({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; exact?: boolean }[];
}) {
  return (
    <div className="pt-6">
      <Tabs label={label} items={items} />
    </div>
  );
}

export function ProductsTabs() {
  return (
    <SectionTabs
      label="Products"
      items={[
        { href: "/products", label: "Products" },
        { href: "/price-lists", label: "Price lists" },
      ]}
    />
  );
}

export function SalesTabs() {
  return (
    <SectionTabs
      label="Sales"
      items={[
        { href: "/sales", label: "Overview", exact: true },
        { href: "/credit-notes", label: "Credit notes" },
        { href: "/sales-returns", label: "Sales returns" },
      ]}
    />
  );
}

export function SettingsTabs() {
  return (
    <SectionTabs
      label="Settings"
      items={[
        { href: "/settings/company", label: "Company" },
        { href: "/settings/tax", label: "Tax rates" },
        { href: "/settings/users", label: "Users" },
        { href: "/account", label: "Your account" },
        { href: "/audit", label: "Audit log" },
        { href: "/backups", label: "Backups" },
        { href: "/imports", label: "Imports" },
        { href: "/settings/speed", label: "Speed check" },
      ]}
    />
  );
}

/** A layout that just puts a section's tabs above its pages. */
export function withTabs(TabsComponent: () => ReactNode) {
  return function SectionLayout({ children }: { children: ReactNode }) {
    return (
      <>
        <TabsComponent />
        {children}
      </>
    );
  };
}
