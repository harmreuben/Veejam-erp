import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDecimal } from "@/lib/money";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { listPayments } from "@/server/modules/payments/service";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="payments" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const method = param(sp.method) ?? "ALL";
  const show = param(sp.show) ?? "CURRENT";
  const rows = await listPayments(getDb(), toActor(user), { q, method, deleted: show === "DELETED" });
  return (
    <Page wide>
      <PageHeader
        title="Payments"
        description="Money received from customers. Each payment gets a receipt and is applied to their oldest invoices unless you choose otherwise."
        actions={
          hasPermission(user, "payments.record") && (
            <Button asChild>
              <Link href="/payments/new">
                <Plus aria-hidden /> Record payment
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Receipt number, M-Pesa code or customer"
        selects={[
          {
            name: "method",
            label: "Method",
            value: method,
            options: [
              { value: "ALL", label: "All" },
              ...Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
          {
            name: "show",
            label: "Show",
            value: show,
            options: [
              { value: "CURRENT", label: "Payments" },
              { value: "DELETED", label: "Deleted" },
            ],
          },
        ]}
      />
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Receipt</TH>
            <TH>Date</TH>
            <TH>Customer</TH>
            <TH>Method</TH>
            <TH numeric>Amount</TH>
            <TH numeric>Not yet applied</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={7}>{q ? "Nothing matches that search." : "No payments yet."}</EmptyRow>
          )}
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/payments/${p.id}`} className="text-primary font-medium hover:underline">
                  {p.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(p.receivedOn)}</TD>
              <TD>
                <Link href={`/customers/${p.customer.id}`} className="hover:underline">
                  {p.customer.name}
                </Link>
              </TD>
              <TD>
                {METHOD_LABELS[p.method]}
                {p.reference && <div className="text-muted-foreground font-mono text-xs">{p.reference}</div>}
              </TD>
              <TD numeric>
                <Money value={p.amount} />
              </TD>
              <TD numeric>{toDecimal(p.unapplied).greaterThan(0) ? <Money value={p.unapplied} /> : ""}</TD>
              <TD>
                {p.status === "REVERSED" ? (
                  <Badge variant="secondary">Reversed</Badge>
                ) : (
                  <Badge variant="success">Received</Badge>
                )}
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
