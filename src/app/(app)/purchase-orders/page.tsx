import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatShortDay } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listPurchaseOrders } from "@/server/modules/purchasing/orders";
import { PO_STATUS_LABELS } from "@/server/modules/purchasing/schemas";

import { PoStatusBadge } from "../_purchasing/ui";

export const metadata = { title: "Purchase orders" };

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="purchasing" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = param(sp.status) ?? "OPEN";
  const { rows, showCosts } = await listPurchaseOrders(getDb(), toActor(user), {
    q,
    status: status === "ALL" ? undefined : status,
  });
  return (
    <Page wide>
      <PageHeader
        title="Purchase orders"
        description="What VeeJam has ordered from suppliers. Send the PDF to the supplier, then receive the goods against the order when they arrive."
        actions={
          hasPermission(user, "purchasing.manage") && (
            <Button asChild>
              <Link href="/purchase-orders/new">
                <Plus aria-hidden /> New purchase order
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="PO number or supplier"
        selects={[
          {
            name: "status",
            label: "Status",
            value: status,
            options: [
              { value: "OPEN", label: "Open (draft, ordered, partly received)" },
              { value: "ALL", label: "All" },
              ...Object.entries(PO_STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
      />
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Order</TH>
            <TH>Date</TH>
            <TH>Supplier</TH>
            <TH>Expected</TH>
            {showCosts && <TH numeric>Total</TH>}
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={showCosts ? 6 : 5} art={q ? "search" : "truck"}>
              {q ? "Nothing matches that search." : "No purchase orders here."}
            </EmptyRow>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/purchase-orders/${r.id}`} className="text-primary font-medium hover:underline">
                  {r.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatShortDay(r.orderDate)}</TD>
              <TD>{r.supplier}</TD>
              <TD className="whitespace-nowrap">{r.expectedDate ? formatShortDay(r.expectedDate) : "—"}</TD>
              {showCosts && (
                <TD numeric>
                  <Money value={r.total} />
                </TD>
              )}
              <TD>
                <PoStatusBadge status={r.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
