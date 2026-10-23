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
import { listGoodsReceipts } from "@/server/modules/purchasing/receipts";

export const metadata = { title: "Goods received" };

export default async function GoodsReceivedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="purchasing" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const show = param(sp.show) ?? "ALL";
  const { rows, showCosts } = await listGoodsReceipts(getDb(), toActor(user), {
    q,
    unbilled: show === "UNBILLED",
  });
  const billsLink = hasPermission(user, "payables.view");
  return (
    <Page wide>
      <PageHeader
        title="Goods received"
        description="Every delivery from a supplier (GRN). Each one puts stock in at cost and waits for the supplier's bill."
        actions={
          hasPermission(user, "goods.receive") && (
            <Button asChild>
              <Link href="/goods-received/new">
                <Plus aria-hidden /> Receive goods
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="GRN, delivery note or supplier"
        selects={[
          {
            name: "show",
            label: "Show",
            value: show,
            options: [
              { value: "ALL", label: "All" },
              { value: "UNBILLED", label: "Waiting for the supplier's bill" },
            ],
          },
        ]}
      />
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Note</TH>
            <TH>Date</TH>
            <TH>Supplier</TH>
            <TH>Order</TH>
            {showCosts && <TH numeric>At cost</TH>}
            <TH>Bill</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={6} art={q ? "search" : "cartons"}>
              {q ? "Nothing matches that search." : "Nothing received yet."}
            </EmptyRow>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/goods-received/${r.id}`} className="text-primary font-medium hover:underline">
                  {r.number}
                </Link>
                {r.supplierReference && (
                  <div className="text-muted-foreground font-mono text-xs">{r.supplierReference}</div>
                )}
              </TD>
              <TD className="whitespace-nowrap">{formatShortDay(r.receivedOn)}</TD>
              <TD>{r.supplier}</TD>
              <TD>
                {r.purchaseOrder ? (
                  <Link href={`/purchase-orders/${r.purchaseOrder.id}`} className="hover:underline">
                    {r.purchaseOrder.number}
                  </Link>
                ) : (
                  "—"
                )}
              </TD>
              {showCosts && (
                <TD numeric>
                  <Money value={r.totalCost} />
                </TD>
              )}
              <TD>
                {r.bill ? (
                  billsLink ? (
                    <Link href={`/supplier-bills/${r.bill.id}`} className="hover:underline">
                      {r.bill.number}
                    </Link>
                  ) : (
                    r.bill.number
                  )
                ) : (
                  <Badge variant="warning">Not billed yet</Badge>
                )}
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
