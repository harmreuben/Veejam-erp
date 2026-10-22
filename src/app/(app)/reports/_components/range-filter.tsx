import Link from "next/link";
import { Download } from "lucide-react";

import { selectClass } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addDays,
  endOfMonth,
  startOfMonth,
  startOfPreviousMonth,
  startOfWeek,
  todayInNairobi,
  type DayRange,
} from "@/lib/dates";

/** From/to dates, quick periods and a CSV download. A plain GET form with shareable URLs. */
export function RangeFilter({
  path,
  range,
  extra = {},
  select,
  csv,
}: {
  path: string;
  range: DayRange;
  extra?: Record<string, string>;
  select?: { name: string; label: string; value: string; options: { value: string; label: string }[] };
  /** Report name for the CSV download (/reports/csv/<name>), or nothing for no download. */
  csv?: string;
}) {
  const today = todayInNairobi();
  const prevStart = startOfPreviousMonth(today);
  const quick: { label: string; from: string; to: string }[] = [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: addDays(today, -1), to: addDays(today, -1) },
    { label: "This week", from: startOfWeek(today), to: today },
    { label: "This month", from: startOfMonth(today), to: today },
    { label: "Last month", from: prevStart, to: endOfMonth(prevStart) },
    { label: "This year", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const keep = { ...extra, ...(select ? { [select.name]: select.value } : {}) };
  const qs = (r: Record<string, string>) => new URLSearchParams({ ...keep, ...r }).toString();

  return (
    <div className="grid gap-3">
      <form method="get" className="flex flex-wrap items-end gap-2">
        {Object.entries(extra).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">From</span>
          <Input type="date" name="from" defaultValue={range.from} max={today} />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">To</span>
          <Input type="date" name="to" defaultValue={range.to} />
        </label>
        {select && (
          <label className="grid gap-1">
            <span className="text-muted-foreground text-xs">{select.label}</span>
            <select name={select.name} defaultValue={select.value} className={selectClass}>
              {select.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" variant="outline">
          Show
        </Button>
        {csv && (
          <Button asChild variant="ghost">
            <a href={`/reports/csv/${csv}?${qs({ from: range.from, to: range.to })}`}>
              <Download aria-hidden /> Download CSV
            </a>
          </Button>
        )}
      </form>
      <nav aria-label="Quick periods" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {quick.map((p) => {
          const active = p.from === range.from && p.to === range.to;
          return (
            <Link
              key={p.label}
              href={`${path}?${qs({ from: p.from, to: p.to })}`}
              aria-current={active ? "true" : undefined}
              className={
                active ? "text-foreground font-medium" : "text-primary underline-offset-4 hover:underline"
              }
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
