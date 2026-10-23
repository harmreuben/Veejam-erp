import Link from "next/link";

import { formatKES, toDecimal } from "@/lib/money";
import { cn } from "@/lib/utils";

/*
 * Small charts drawn in plain HTML on the server: no chart library to download,
 * so they appear as fast as the rest of the page on a slow phone connection.
 * Every figure is also written out as text (bars are decoration for the eye),
 * so they read correctly for screen readers, in print and for colour-blind users.
 */

export type BarItem = {
  key: string;
  label: string;
  /** Second line under the label, e.g. a product code. */
  sub?: string;
  href?: string;
  /** Amount in KES, as a decimal string. */
  value: string;
  /** Extra text after the amount, e.g. "12 invoices". */
  note?: string;
};

/**
 * Ranked horizontal bars: the label and amount on one line, the bar under it.
 * One colour; the longest bar is the biggest amount in the list.
 */
export function BarList({
  items,
  empty,
  className,
}: {
  items: BarItem[];
  empty: string;
  className?: string;
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground bg-card rounded-lg border p-4 text-sm">{empty}</p>;
  }
  const max = Math.max(...items.map((i) => Math.max(0, Number(i.value))), 0);
  return (
    <ol className={cn("bg-card grid gap-3 rounded-lg border p-4", className)}>
      {items.map((i, n) => {
        const share = max > 0 ? Math.max(0, Number(i.value)) / max : 0;
        return (
          <li key={i.key} className="grid gap-1">
            <div className="flex items-baseline gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {i.href ? (
                  <Link href={i.href} className="hover:underline">
                    {i.label}
                  </Link>
                ) : (
                  i.label
                )}
                {i.sub && <span className="text-muted-foreground ml-2 font-mono text-xs">{i.sub}</span>}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatKES(i.value)}</span>
            </div>
            <div className="flex items-center gap-3">
              <div aria-hidden className="bg-muted h-2 flex-1 overflow-hidden rounded">
                <div
                  className="vj-grow h-full rounded bg-[var(--chart-1)]"
                  style={{ width: `${share * 100}%`, animationDelay: `${n * 50}ms` }}
                />
              </div>
              {i.note && (
                <span className="text-muted-foreground w-24 shrink-0 text-right text-xs tabular-nums">
                  {i.note}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export type SplitPart = {
  label: string;
  /** Amount in KES, as a decimal string. */
  value: string;
  /** A CSS colour, e.g. "var(--chart-1)". */
  color: string;
  /** Show this part's figures in the warning colour (e.g. long overdue). */
  alert?: boolean;
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * One bar split into parts that add up to a whole (e.g. money owed by age),
 * with a legend that gives each part's amount and share.
 */
export function SplitBar({
  parts,
  label,
  empty,
}: {
  parts: SplitPart[];
  label: string;
  /** Shown instead of the bar when every part is zero. */
  empty?: React.ReactNode;
}) {
  const total = parts.reduce((s, p) => s.plus(toDecimal(p.value)), toDecimal(0));
  const whole = total.toNumber();
  const shown = parts.filter((p) => Number(p.value) > 0);
  if (whole <= 0 && empty) return <>{empty}</>;
  return (
    <figure className="grid gap-3">
      <figcaption className="sr-only">{label}</figcaption>
      {whole > 0 ? (
        <div aria-hidden className="vj-grow flex h-4 gap-0.5 overflow-hidden rounded">
          {shown.map((p) => (
            <div
              key={p.label}
              title={`${p.label}: ${formatKES(p.value)} (${pct(Number(p.value), whole)}%)`}
              className="h-full min-w-1 first:rounded-l last:rounded-r"
              style={{ flexGrow: Number(p.value), flexBasis: 0, background: p.color }}
            />
          ))}
        </div>
      ) : (
        <div aria-hidden className="bg-muted h-4 rounded" />
      )}
      <ul className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{p.label}</span>
            <span
              className={cn("tabular-nums", p.alert && Number(p.value) > 0 && "text-destructive font-medium")}
            >
              {formatKES(p.value)}
            </span>
            <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
              {pct(Number(p.value), whole)}%
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Ageing parts in the fixed age colours (not yet due → over 90 days). */
export function ageParts(labels: readonly string[], amounts: string[]): SplitPart[] {
  return labels.map((label, i) => ({
    label,
    value: amounts[i] ?? "0.00",
    color: `var(--age-${i + 1})`,
    alert: i >= 3,
  }));
}

export type Column = { key: string; label: string; value: string };

const compact = new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Amounts over time as columns (one per day or month), oldest on the left.
 * Hover or tap a column for its figure; the exact figures are in the table below it.
 */
export function Columns({ points, label }: { points: Column[]; label: string }) {
  const max = Math.max(0, ...points.map((p) => Number(p.value)));
  const mid = points.length > 2 ? points[Math.floor((points.length - 1) / 2)] : undefined;
  return (
    <figure className="bg-card grid gap-2 rounded-lg border p-4">
      <figcaption className="sr-only">{label}. The figures are in the table below.</figcaption>
      <div aria-hidden className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>KES {compact.format(max)}</span>
      </div>
      <div aria-hidden className="border-border flex h-40 items-end gap-0.5 border-b">
        {points.map((p, n) => {
          const v = Math.max(0, Number(p.value));
          return (
            <div
              key={p.key}
              className="group relative flex h-full flex-1 items-end"
              title={`${p.label}: ${formatKES(p.value)}`}
            >
              <div
                className="vj-rise-col w-full rounded-t bg-[var(--chart-1)] group-hover:opacity-80"
                style={{
                  height: max > 0 ? `${(v / max) * 100}%` : 0,
                  minHeight: v > 0 ? 2 : 0,
                  animationDelay: `${Math.min(n * 15, 300)}ms`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div aria-hidden className="text-muted-foreground flex justify-between gap-2 text-xs">
        <span>{points[0]?.label}</span>
        {mid && <span>{mid.label}</span>}
        {points.length > 1 && <span>{points.at(-1)!.label}</span>}
      </div>
    </figure>
  );
}
