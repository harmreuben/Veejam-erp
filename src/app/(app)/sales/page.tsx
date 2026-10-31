import Link from "next/link";

import { BarList, Columns } from "@/components/charts";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatShortDay, startOfMonth, todayInNairobi } from "@/lib/dates";
import { formatKES } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { salesReport } from "@/server/modules/reports/service";

import { rangeFrom } from "../reports/_components/read";
import { RangeFilter } from "../reports/_components/range-filter";
import { RangeError, Stat } from "../reports/_components/stat";

export const metadata = { title: "Sales" };

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** What was sold in a period: totals, by day, and the best customers and products. */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="sales" />;
  if (!hasPermission(user, "reports.view")) return <NoAccess what="sales figures" />;
  const today = todayInNairobi();
  const { range, error } = rangeFrom(await searchParams, { from: startOfMonth(today), to: today });
  const db = getDb();
  const actor = toActor(user);
  const [byDay, byCustomer, byProduct] = await Promise.all([
    salesReport(db, actor, range, "day"),
    salesReport(db, actor, range, "customer"),
    salesReport(db, actor, range, "product"),
  ]);
  const t = byDay.totals;
  const q = `from=${range.from}&to=${range.to}`;
  return (
    <Page wide>
      <PageHeader
        title="Sales"
        description="Posted invoices less credit notes, including VAT, for the period you choose."
        actions={
          <Button asChild variant="outline">
            <Link href={`/reports/sales?${q}`}>Full sales report</Link>
          </Button>
        }
      />
      <RangeFilter path="/sales" range={range} />
      <RangeError message={error} />
      <div className="vj-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Net sales (incl. VAT)"
          value={formatKES(t.netGross)}
          note={plural(t.invoices, "invoice")}
        />
        <Stat label="Invoiced" value={formatKES(t.gross)} />
        <Stat
          label="Credit notes"
          value={formatKES(t.returnsGross)}
          note={plural(t.creditNotes, "credit note")}
        />
        <Stat label="Net sales (excl. VAT)" value={formatKES(t.netSales)} note={`VAT ${formatKES(t.vat)}`} />
      </div>
      {byDay.rows.length > 1 && (
        <Section title="By day">
          <Columns
            label="Net sales by day"
            points={byDay.rows.map((r) => ({
              key: r.key,
              label: formatShortDay(r.label),
              value: r.netGross,
            }))}
          />
        </Section>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Top customers">
          <BarList
            empty="No sales in this period."
            items={byCustomer.rows.slice(0, 8).map((r) => ({
              key: r.key,
              label: r.label,
              href: r.href ?? undefined,
              value: r.netGross,
              note: plural(r.documents, "invoice"),
            }))}
          />
        </Section>
        <Section title="Top products">
          <BarList
            empty="No sales in this period."
            items={byProduct.rows.slice(0, 8).map((r) => ({
              key: r.key,
              label: r.label,
              sub: r.sub ?? undefined,
              value: r.netGross,
              note: plural(r.documents, "invoice"),
            }))}
          />
        </Section>
      </div>
    </Page>
  );
}
