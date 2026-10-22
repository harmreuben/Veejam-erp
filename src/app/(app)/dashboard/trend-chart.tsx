"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { formatKES } from "@/lib/money";

type Point = { day: string; label: string; sales: number; received: number };

const compact = new Intl.NumberFormat("en-KE", { notation: "compact", maximumFractionDigits: 1 });

function Tip({
  active,
  payload,
  label,
  salesLabel,
  receivedLabel,
}: TooltipContentProps<number, string> & { salesLabel: string; receivedLabel: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as Point;
  return (
    <div className="bg-popover text-popover-foreground grid gap-1 rounded-md border px-3 py-2 text-xs shadow-md">
      <div className="font-medium">{label}</div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2.5 rounded-sm bg-[var(--chart-1)]" />
        {salesLabel} <span className="ml-auto pl-4 tabular-nums">{formatKES(p.sales)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-3 rounded bg-[var(--chart-2)]" />
        {receivedLabel} <span className="ml-auto pl-4 tabular-nums">{formatKES(p.received)}</span>
      </div>
    </div>
  );
}

/** Daily sales (bars) and money received (line) for the last 30 days. One KES axis. */
export function TrendChart({
  data,
  salesLabel = "Sales (after credit notes)",
  receivedLabel = "Money received",
  description = "Daily sales and money received over the last 30 days. A table of the same figures follows.",
}: {
  data: Point[];
  salesLabel?: string;
  receivedLabel?: string;
  /** What the chart shows, for screen readers. */
  description?: string;
}) {
  return (
    <div className="grid gap-3">
      <div className="text-muted-foreground flex flex-wrap gap-4 text-xs" aria-hidden>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm bg-[var(--chart-1)]" /> {salesLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-4 rounded bg-[var(--chart-2)]" /> {receivedLabel}
        </span>
      </div>
      <div className="h-64 w-full" role="img" aria-label={description}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <Tooltip
              content={(props) => (
                <Tip
                  {...(props as TooltipContentProps<number, string>)}
                  salesLabel={salesLabel}
                  receivedLabel={receivedLabel}
                />
              )}
              cursor={{ fill: "var(--muted)" }}
            />
            <Bar dataKey="sales" name="Sales" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
            <Line
              dataKey="received"
              name={receivedLabel}
              type="linear"
              stroke="var(--chart-2)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
