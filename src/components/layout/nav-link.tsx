"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/** Sidebar link that marks itself as the current page. */
export function NavLink({
  href,
  exact = false,
  match = [],
  className,
  children,
}: {
  href: string;
  exact?: boolean;
  /** Other path prefixes that count as this link's section. */
  match?: readonly string[];
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const under = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
  const active = exact ? pathname === href : under(href) || match.some(under);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-sidebar-active font-medium text-white shadow-sm"
          : "text-sidebar-foreground/90 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}
