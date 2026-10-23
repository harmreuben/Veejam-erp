import Link from "next/link";

import { FilterBar, param } from "@/components/filters";
import { Qty } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { stockLevels } from "@/server/modules/inventory/queries";

export const metadata = { title: "Stock levels" };

export default async function StockLevelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = param(sp.q);
  const lowOnly = param(sp.low) === "1";
  const { warehouses, rows } = await stockLevels(getDb(), toActor(user), { q, lowOnly });

  return (
    <Page wide>
      <PageHeader
        title="Stock levels"
        description="Pieces on hand, with the carton and pack breakdown. Changes only through adjustments, transfers, counts and (from Phase 4) invoices."
        actions={
          <>
            {hasPermission(user, "inventory.adjust") && (
              <Button asChild variant="outline">
                <Link href="/inventory/adjustments/new">Adjust stock</Link>
              </Button>
            )}
            {hasPermission(user, "inventory.transfer") && warehouses.length > 1 && (
              <Button asChild variant="outline">
                <Link href="/inventory/transfers/new">Transfer</Link>
              </Button>
            )}
          </>
        }
      />
      <FilterBar
        q={q}
        placeholder="Product, SKU or brand"
        checkbox={{ name: "low", label: "Low stock only", checked: lowOnly }}
      />
      <Table minWidth={560 + warehouses.length * 160}>
        <THead>
          <tr>
            <TH>Product</TH>
            {warehouses.map((w) => (
              <TH key={w.id} numeric>
                {w.name}
              </TH>
            ))}
            {warehouses.length > 1 && <TH numeric>Total</TH>}
            <TH numeric>Reorder at</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={warehouses.length + 3} art={lowOnly ? "done" : "cartons"}>
              {lowOnly
                ? "Nothing is low on stock."
                : "No products yet. Add products, then record opening stock with a stock count or an adjustment."}
            </EmptyRow>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/products/${r.id}`} className="font-medium hover:underline">
                  {r.name}
                </Link>{" "}
                {r.low && <Badge variant="warning">Low</Badge>}
                {r.status === "INACTIVE" && <Badge variant="secondary">Inactive</Badge>}
                <div className="text-muted-foreground text-xs">{r.sku}</div>
              </TD>
              {warehouses.map((w) => (
                <TD key={w.id} numeric className="text-xs">
                  <Qty pieces={r.byWarehouse[w.id] ?? 0} sizes={r} />
                </TD>
              ))}
              {warehouses.length > 1 && (
                <TD numeric className="text-xs font-medium">
                  <Qty pieces={r.total} sizes={r} />
                </TD>
              )}
              <TD numeric className="text-muted-foreground text-xs">
                {r.reorderLevel.toLocaleString("en-KE")} pcs
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
