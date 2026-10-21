"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/inventory", label: "Stock levels", exact: true },
  { href: "/inventory/movements", label: "Movements" },
  { href: "/inventory/adjustments", label: "Adjustments" },
  { href: "/inventory/transfers", label: "Transfers" },
  { href: "/inventory/counts", label: "Stock counts" },
  { href: "/inventory/warehouses", label: "Warehouses" },
];

export function InventoryTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Inventory" className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto px-4 md:px-10">
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block border-b-2 px-3 py-3 text-sm whitespace-nowrap",
                  active
                    ? "border-primary text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
