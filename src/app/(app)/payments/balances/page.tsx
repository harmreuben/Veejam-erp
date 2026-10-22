import Link from "next/link";

import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Download } from "lucide-react";

import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { agedReceivables } from "@/server/modules/payments/service";

export const metadata = { title: "Customer balances" };

export default async function BalancesPage() {
  const user = await pageUser("customers.view");
  if (!user) return <NoAccess what="customer balances" />;
  const aged = await agedReceivables(getDb(), toActor(user));
  return (
    <Page wide>
      <PageHeader
        title="Customer balances"
        description="Who owes what, by how long it's been overdue (counted from each invoice's due date)."
        actions={
          hasPermission(user, "reports.view") && (
            <Button asChild variant="ghost">
              {/* A file download from a route handler, not a page: a plain link is right here. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/reports/csv/receivables">
                <Download aria-hidden /> Download CSV
              </a>
            </Button>
          )
        }
      />
      <Table minWidth={900}>
        <THead>
          <tr>
            <TH>Customer</TH>
            {aged.buckets.map((b) => (
              <TH key={b} numeric>
                {b}
              </TH>
            ))}
            <TH numeric>Owed</TH>
            <TH numeric>Credit</TH>
          </tr>
        </THead>
        <TBody>
          {aged.rows.length === 0 && <EmptyRow colSpan={8}>Nobody owes anything.</EmptyRow>}
          {aged.rows.map((r) => (
            <tr key={r.customerId} className="hover:bg-muted/50">
              <TD>
                <Link
                  href={`/customers/${r.customerId}/statement`}
                  className="text-primary font-medium hover:underline"
                >
                  {r.name}
                </Link>
                <div className="text-muted-foreground text-xs">{r.code}</div>
              </TD>
              {r.buckets.map((b, i) => (
                <TD
                  key={i}
                  numeric
                  className={i >= 3 && toDecimal(b).greaterThan(0) ? "text-destructive" : undefined}
                >
                  {toDecimal(b).isZero() ? "" : <Money value={b} />}
                </TD>
              ))}
              <TD numeric className="font-medium">
                <Money value={r.owed} />
              </TD>
              <TD numeric>{toDecimal(r.credit).isZero() ? "" : <Money value={r.credit} />}</TD>
            </tr>
          ))}
          {aged.rows.length > 0 && (
            <tr className="bg-muted/40 font-semibold">
              <TD>Total</TD>
              {aged.totals.map((t, i) => (
                <TD key={i} numeric>
                  <Money value={t} />
                </TD>
              ))}
              <TD numeric>
                <Money value={aged.total} />
              </TD>
              <TD />
            </tr>
          )}
        </TBody>
      </Table>
    </Page>
  );
}
