import Link from "next/link";

import { toDecimal } from "@/lib/money";
import { cn } from "@/lib/utils";

/** A headline figure on a dashboard, optionally linking to the detail. */
export function Tile({
  label,
  value,
  note,
  href,
  tone,
}: {
  label: string;
  value: string;
  note?: React.ReactNode;
  href?: string;
  tone?: "warning";
}) {
  const body = (
    <>
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", tone === "warning" && "text-warning")}>
        {value}
      </div>
      {note && <div className="text-muted-foreground text-xs">{note}</div>}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="bg-card hover:border-primary/50 grid gap-1 rounded-lg border p-4 transition-colors"
    >
      {body}
    </Link>
  ) : (
    <div className="bg-card grid gap-1 rounded-lg border p-4">{body}</div>
  );
}

export function change(now: string, before: string): string | null {
  const b = toDecimal(before);
  if (b.isZero()) return null;
  const pct = toDecimal(now).minus(b).dividedBy(b).times(100).toDecimalPlaces(0).toNumber();
  return `${pct >= 0 ? "+" : ""}${pct}% vs the same days last month`;
}
