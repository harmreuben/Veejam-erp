import Link from "next/link";

import { Money } from "@/components/format";
import { Page, PageHeader, Section } from "@/components/page";
import { Tabs } from "@/components/tabs";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay, formatShortDay } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { hasPermission } from "@/server/auth/permissions";
import type { AppUser } from "@/server/auth/resolve";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { myDashboard } from "@/server/modules/reports/service";

import { change, Tile } from "./parts";
import { TrendChart } from "./trend-chart";

/** Shown to people who have both the business dashboard and their own. */
export function DashboardTabs() {
  return (
    <Tabs
      label="Dashboards"
      items={[
        { href: "/dashboard", label: "Business", exact: true },
        { href: "/dashboard/mine", label: "My sales" },
      ]}
    />
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A salesperson's own progress: what they sold, collected, have open, and should chase. */
export async function MyDashboard({ user, withTabs = false }: { user: AppUser; withTabs?: boolean }) {
  const d = await myDashboard(getDb(), toActor(user));
  const firstName = user.fullName.split(" ")[0];
  const chart = d.trend.map((t) => ({
    day: t.day,
    label: formatShortDay(t.day),
    sales: Number(t.sales),
    received: Number(t.received),
  }));
  const canInvoice = hasPermission(user, "invoices.manage");
  const canPay = hasPermission(user, "payments.record");

  return (
    <>
      {withTabs && <DashboardTabs />}
      <Page wide>
        <PageHeader
          title={withTabs ? "My sales" : "Dashboard"}
          description={`${firstName}'s sales on ${formatLongDay(d.today)}: invoices you wrote, VAT-inclusive, less credit notes on them.`}
          actions={
            canInvoice && (
              <Button asChild>
                <Link href="/invoices/new">New invoice</Link>
              </Button>
            )
          }
        />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tile
            label="Your sales today"
            value={formatKES(d.todaySales.netGross)}
            note={plural(d.todaySales.invoices, "invoice")}
            href="/invoices?status=POSTED"
          />
          <Tile
            label="Your sales this month"
            value={formatKES(d.monthSales.netGross)}
            note={
              change(d.monthSales.netGross, d.prevMonthSales.netGross) ??
              plural(d.monthSales.invoices, "invoice")
            }
          />
          <Tile
            label="Money you recorded this month"
            value={formatKES(d.monthReceived)}
            note={plural(d.paymentsRecorded, "payment")}
            href="/payments"
          />
          <Tile
            label="Open quotations"
            value={String(d.open.quotes)}
            note={`worth ${formatKES(d.open.quotesValue)}`}
            href="/quotations"
          />
          <Tile
            label="Orders to invoice"
            value={String(d.open.orders)}
            note={
              <>
                worth {formatKES(d.open.ordersValue)}
                {d.open.draftInvoices > 0 && ` · ${plural(d.open.draftInvoices, "draft invoice")}`}
              </>
            }
            href="/sales-orders"
          />
          <Tile
            label="Overdue on your invoices"
            value={formatKES(d.overdueTotal)}
            note={d.overdueCount ? `${plural(d.overdueCount, "invoice")} to follow up` : "nothing overdue"}
            tone={toDecimal(d.overdueTotal).greaterThan(0) ? "warning" : undefined}
          />
        </div>

        <Section title="Your last 30 days" description="What you sold each day, and the money you recorded.">
          <div className="bg-card rounded-lg border p-4">
            <TrendChart
              data={chart}
              salesLabel="Your sales"
              receivedLabel="Money you recorded"
              description="Your daily sales and the money you recorded over the last 30 days. A table of the same figures follows."
            />
            <details className="mt-3 text-sm">
              <summary className="text-muted-foreground cursor-pointer">Show as a table</summary>
              <Table minWidth={420}>
                <THead>
                  <tr>
                    <TH>Day</TH>
                    <TH numeric>Your sales</TH>
                    <TH numeric>Money recorded</TH>
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

        <Section
          title="To follow up"
          description="Your customers' invoices that are past their due date, oldest first."
        >
          <Table minWidth={520}>
            <THead>
              <tr>
                <TH>Invoice</TH>
                <TH>Customer</TH>
                <TH numeric>Days overdue</TH>
                <TH numeric>Still owed</TH>
                {canPay && <TH />}
              </tr>
            </THead>
            <TBody>
              {d.toChase.length === 0 && (
                <EmptyRow colSpan={canPay ? 5 : 4}>Nothing overdue. Well done.</EmptyRow>
              )}
              {d.toChase.map((c) => (
                <tr key={c.id}>
                  <TD>
                    <Link href={`/invoices/${c.id}`} className="font-mono hover:underline">
                      {c.number}
                    </Link>
                  </TD>
                  <TD>
                    <Link href={`/customers/${c.customerId}`} className="hover:underline">
                      {c.customer}
                    </Link>
                  </TD>
                  <TD numeric>{c.daysOverdue}</TD>
                  <TD numeric>
                    <Money value={c.balance} />
                  </TD>
                  {canPay && (
                    <TD numeric>
                      <Link
                        href={`/payments/new?customer=${c.customerId}&invoice=${c.id}`}
                        className="text-primary text-sm hover:underline"
                      >
                        Record payment
                      </Link>
                    </TD>
                  )}
                </tr>
              ))}
            </TBody>
          </Table>
          {d.overdueCount > d.toChase.length && (
            <p className="text-muted-foreground text-sm">
              Showing the oldest {d.toChase.length} of {d.overdueCount}.
            </p>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Your top customers this month" description="Invoiced, before any credit notes.">
            <Table minWidth={360}>
              <THead>
                <tr>
                  <TH>Customer</TH>
                  <TH numeric>Invoices</TH>
                  <TH numeric>Invoiced</TH>
                </tr>
              </THead>
              <TBody>
                {d.topCustomers.length === 0 && <EmptyRow colSpan={3}>No sales yet this month.</EmptyRow>}
                {d.topCustomers.map((r) => (
                  <tr key={r.id}>
                    <TD>
                      <Link href={`/customers/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </TD>
                    <TD numeric>{r.invoices}</TD>
                    <TD numeric>
                      <Money value={r.gross} />
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Section>
          <Section title="What you sold most this month" description="Invoiced, before any credit notes.">
            <Table minWidth={360}>
              <THead>
                <tr>
                  <TH>Product</TH>
                  <TH numeric>Invoices</TH>
                  <TH numeric>Invoiced</TH>
                </tr>
              </THead>
              <TBody>
                {d.topProducts.length === 0 && <EmptyRow colSpan={3}>No sales yet this month.</EmptyRow>}
                {d.topProducts.map((r) => (
                  <tr key={r.sku}>
                    <TD>
                      {r.name}
                      <div className="text-muted-foreground font-mono text-xs">{r.sku}</div>
                    </TD>
                    <TD numeric>{r.invoices}</TD>
                    <TD numeric>
                      <Money value={r.gross} />
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Section>
        </div>
      </Page>
    </>
  );
}
