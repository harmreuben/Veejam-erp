import * as React from "react";

import { cn } from "@/lib/utils";

import { Breadcrumbs } from "./breadcrumbs";

/**
 * Page wrapper: the same side padding and spacing everywhere (design handover:
 * `w-full px-4 sm:px-6 lg:px-8 space-y-6 max-w-[1600px] mx-auto`). Lists and
 * reports use the full width; forms and detail pages stay narrower to read well.
 */
export function Page({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto grid w-full grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
        wide ? "max-w-[1600px]" : "max-w-5xl",
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="grid gap-2 border-b pb-5">
      <Breadcrumbs back={back} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-[1.7rem]">{title}</h1>
          {description && <div className="text-muted-foreground max-w-[75ch] text-sm">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A label/value list for detail pages. */
export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(({ label, value }) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
