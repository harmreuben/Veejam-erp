"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** A row of page tabs; the current one is worked out from the URL. */
export function Tabs({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string; exact?: boolean }[];
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto px-4 md:px-10">
        {items.map((t) => {
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
