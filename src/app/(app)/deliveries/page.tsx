import Link from "next/link";

import { FilterBar, param } from "@/components/filters";
import { formatDateTime, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { DELIVERY_STATUS_LABELS, listDeliveryNotes } from "@/server/modules/sales/extras";

import { DeliveryStatusBadge } from "../_sales/status";

export const metadata = { title: "Deliveries" };

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="deliveries" />;
  const sp = await searchParams;
  const status = param(sp.status) ?? "ALL";
  const q = param(sp.q);
  const rows = await listDeliveryNotes(getDb(), toActor(user), { status, q });
  return (
    <Page wide>
      <PageHeader
        title="Deliveries"
        description="Delivery notes for posted invoices. Make one from the invoice page; print it for the driver and have the customer sign."
      />
      <FilterBar
        q={q}
        placeholder="Delivery note, invoice number or customer"
        selects={[
          {
            name: "status",
            label: "Status",
            value: status,
            options: [
              { value: "ALL", label: "All" },
              ...Object.entries(DELIVERY_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
      />
      <Table minWidth={720}>
        <THead>
          <tr>
            <TH>Number</TH>
            <TH>Invoice</TH>
            <TH>Customer</TH>
            <TH numeric>Invoice total</TH>
            <TH>Made</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={6} art="truck">
              No delivery notes yet.
            </EmptyRow>
          )}
          {rows.map((n) => (
            <tr key={n.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/deliveries/${n.id}`} className="text-primary font-medium hover:underline">
                  {n.number}
                </Link>
              </TD>
              <TD>
                <Link href={`/invoices/${n.invoice.id}`} className="hover:underline">
                  {n.invoice.number}
                </Link>
              </TD>
              <TD>
                {n.invoice.customer.name}
                {n.invoice.customer.town && (
                  <span className="text-muted-foreground text-xs"> · {n.invoice.customer.town}</span>
                )}
              </TD>
              <TD numeric>
                <Money value={n.invoice.total.toFixed(2)} />
              </TD>
              <TD className="whitespace-nowrap">{formatDateTime(n.createdAt)}</TD>
              <TD>
                <DeliveryStatusBadge status={n.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
