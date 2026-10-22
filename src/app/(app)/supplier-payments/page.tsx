import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatShortDay } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { listSupplierPayments } from "@/server/modules/purchasing/payables";

export const metadata = { title: "Supplier payments" };

export default async function SupplierPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier payments" />;
  const q = param((await searchParams).q);
  const rows = await listSupplierPayments(getDb(), toActor(user), { q });
  return (
    <Page wide>
      <PageHeader
        title="Supplier payments"
        description="Money paid to suppliers. Each payment goes to their oldest bills unless you choose otherwise."
        actions={
          hasPermission(user, "supplier_payments.manage") && (
            <Button asChild>
              <Link href="/supplier-payments/new">
                <Plus aria-hidden /> Pay a supplier
              </Link>
            </Button>
          )
        }
      />
      <FilterBar q={q} placeholder="Payment number, reference or supplier" />
      <Table minWidth={720}>
        <THead>
          <tr>
            <TH>Payment</TH>
            <TH>Date</TH>
            <TH>Supplier</TH>
            <TH>Method</TH>
            <TH numeric>Amount</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={6}>
              {q ? "Nothing matches that search." : "No supplier payments yet."}
            </EmptyRow>
          )}
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-muted/50">
              <TD>
                <Link
                  href={`/supplier-payments/${p.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {p.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatShortDay(p.paidOn)}</TD>
              <TD>{p.supplier}</TD>
              <TD>
                {METHOD_LABELS[p.method]}
                {p.reference && <div className="text-muted-foreground font-mono text-xs">{p.reference}</div>}
              </TD>
              <TD numeric>
                <Money value={p.amount} />
              </TD>
              <TD>
                {p.status === "REVERSED" ? (
                  <Badge variant="secondary">Reversed</Badge>
                ) : (
                  <Badge variant="success">Paid</Badge>
                )}
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
