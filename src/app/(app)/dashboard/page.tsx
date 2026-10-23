import Link from "next/link";

import { ageParts, BarList, SplitBar } from "@/components/charts";
import { CountUp } from "@/components/count-up";
import { Illustration } from "@/components/illustrations";
import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay, formatShortDay } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { dashboard } from "@/server/modules/reports/service";

import { DashboardTabs, MyDashboard } from "./my-dashboard";
import { change, Tile } from "./parts";
import { TrendChart } from "./trend-chart";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const business = hasPermission(user, "reports.view");
  const mine = hasPermission(user, "dashboard.own");
  if (!business && !mine) return <NoAccess what="the dashboard" />;
  // Salespeople without the business view get their own dashboard here.
  if (!business) return <MyDashboard user={user} />;
  const d = await dashboard(getDb(), toActor(user));
  const chart = d.trend.map((t) => ({
    day: t.day,
    label: formatShortDay(t.day),
    sales: Number(t.sales),
    received: Number(t.received),
  }));

  return (
    <>
      {mine && <DashboardTabs />}
      <Page wide>
        <PageHeader
          title="Dashboard"
          description={`How the business stands on ${formatLongDay(d.today)}. Sales are VAT-inclusive, less credit notes.`}
          actions={
            <Button asChild variant="outline">
              <Link href="/reports">All reports</Link>
            </Button>
          }
        />

        <div className="vj-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile
            label="Sales today"
            value={<CountUp value={d.todaySales.netGross} />}
            note={`${d.todaySales.invoices} invoice${d.todaySales.invoices === 1 ? "" : "s"}`}
            href={`/reports/sales?from=${d.today}&to=${d.today}&group=customer`}
          />
          <Tile
            label="Sales this month"
            value={<CountUp value={d.monthSales.netGross} />}
            note={
              change(d.monthSales.netGross, d.prevMonthSales.netGross) ??
              `${d.monthSales.invoices} invoice${d.monthSales.invoices === 1 ? "" : "s"}`
            }
            href="/reports/sales"
          />
          <Tile
            label="Received this month"
            value={<CountUp value={d.monthReceived} />}
            href="/reports/collections"
          />
          <Tile
            label="Owed by customers"
            value={<CountUp value={d.owed} />}
            note={
              <>
                {formatKES(d.overdue)} overdue · {d.customersOwing} customer
                {d.customersOwing === 1 ? "" : "s"}
              </>
            }
            href="/payments/balances"
            tone={toDecimal(d.overdue).greaterThan(0) ? "warning" : undefined}
          />
          <Tile
            label="Low stock"
            value={<CountUp value={d.lowStock} kind="count" />}
            note="products at or below reorder level"
            href="/inventory?low=1"
            tone={d.lowStock > 0 ? "warning" : undefined}
          />
          {d.stockValue && (
            <Tile
              label="Stock at cost"
              value={<CountUp value={d.stockValue.total} />}
              note={
                d.stockValue.missing
                  ? `${d.stockValue.missing} product${d.stockValue.missing === 1 ? " has" : "s have"} stock with no cost`
                  : "all products costed"
              }
              href="/reports/stock"
            />
          )}
        </div>

        <Section title="Last 30 days" description="Daily sales and money received.">
          <div className="bg-card rounded-lg border p-4">
            <TrendChart data={chart} />
            <details className="mt-3 text-sm">
              <summary className="text-muted-foreground cursor-pointer">Show as a table</summary>
              <Table minWidth={420}>
                <THead>
                  <tr>
                    <TH>Day</TH>
                    <TH numeric>Sales</TH>
                    <TH numeric>Received</TH>
                  </tr>
                </THead>
                <TBody>
                  {d.trend.map((t) => (
                    <tr key={t.day}>
                      <TD>{formatShortDay(t.day)}</TD>
                      <TD numeric>
                        <Money value={t.sales} />
                      </TD>
                      <TD numeric>
                        <Money value={t.received} />
                      </TD>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </details>
          </div>
        </Section>

        {d.ageing && (
          <Section
            title="Money owed, by age"
            description="What customers owe, by how long it's been overdue."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/payments/balances">Who owes what</Link>
              </Button>
            }
          >
            <div className="bg-card rounded-lg border p-4">
              <SplitBar
                label="Money owed by customers, by age"
                parts={ageParts(d.ageing.buckets, d.ageing.totals)}
                empty={
                  <div className="text-muted-foreground flex items-center gap-4 text-sm">
                    <Illustration name="done" className="h-16 w-20" />
                    Nobody owes anything right now.
                  </div>
                }
              />
            </div>
          </Section>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Top customers this month">
            <BarList
              empty="No sales yet this month."
              items={d.topCustomers.map((r) => ({
                key: r.key,
                label: r.label,
                href: r.href ?? undefined,
                value: r.netGross,
                note: plural(r.documents, "invoice"),
              }))}
            />
          </Section>
          <Section title="Top products this month">
            <BarList
              empty="No sales yet this month."
              items={d.topProducts.map((r) => ({
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
    </>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
