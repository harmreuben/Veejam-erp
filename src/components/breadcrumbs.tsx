"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { moduleForPath } from "@/config/modules";

/**
 * "Sales › Invoices › INV-000123" above a page title: the menu section, the
 * module (a link, unless you're on it) and, on a detail page, its parent.
 * On phones only the way back is shown, to keep the header short.
 */
export function Breadcrumbs({ back }: { back?: { href: string; label: string } }) {
  const pathname = usePathname();
  const mod = moduleForPath(pathname);
  const crumbs: { href?: string; label: string }[] = [];
  if (mod) {
    crumbs.push({ label: mod.group });
    if (pathname !== mod.href) crumbs.push({ href: mod.href, label: mod.name });
  }
  if (back && back.href !== mod?.href) crumbs.push(back);
  if (!crumbs.length) return null;
  const up = back ?? (mod && pathname !== mod.href ? { href: mod.href!, label: mod.name } : undefined);
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-muted-foreground hidden text-xs sm:block">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3 opacity-60" aria-hidden />}
              {c.href ? (
                <Link href={c.href} className="hover:text-link hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {up && (
        <Link
          href={up.href}
          className="text-muted-foreground hover:text-foreground -ml-1 flex w-fit items-center gap-1 text-sm sm:hidden"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {up.label}
        </Link>
      )}
    </>
  );
}
