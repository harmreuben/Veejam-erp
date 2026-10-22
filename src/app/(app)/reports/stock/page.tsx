import { Download } from "lucide-react";

import { Money, Qty } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatKES } from "@/lib/money";
import { formatQuantity } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { stockValuation } from "@/server/modules/reports/service";

import { RevalueButton } from "../../_purchasing/revalue-button";
import { Stat } from "../_components/stat";

export const metadata = { title: "Stock value" };

export default async function StockValuePage() {
  const user = await pageUser("reports.view");
  if (!user || !hasPermission(user, "catalogue.costs")) return <NoAccess what="cost prices" />;
  const r = await stockValuation(getDb(), toActor(user));
  const canRevalue = hasPermission(user, "inventory.revalue");
  return (
    <Page wide>
      <PageHeader
        title="Stock value"
        description="Stock on hand at what it cost (weighted average, excluding VAT). Goods received come in at their purchase cost and every sale takes its cost out, so this always matches the Inventory account."
        actions={
          <Button asChild variant="ghost">
            {/* A file download from a route handler, not a page: a plain link is right here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/reports/csv/stock">
              <Download aria-hidden /> Download CSV
            </a>
          </Button>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Stock at cost" value={formatKES(r.total)} />
        <Stat
          label="Products in stock without a cost"
          value={String(r.missing)}
          note={
            r.missing
              ? canRevalue
                ? "Set their cost below; until then their sales show no cost of goods sold."
                : "An owner or administrator needs to set their cost."
              : "Every product in stock has a cost."
          }
        />
      </div>
      {r.missing > 0 && (
        <p className="bg-warning-soft rounded-md p-3 text-sm">
          <strong>Set the cost of stock that has none before new deliveries of it arrive.</strong> Otherwise
          new stock averages with stock valued at nothing. Use the cost per piece from the supplier&apos;s
          invoice and tick &ldquo;opening stock&rdquo;.
        </p>
      )}
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>On hand</TH>
            <TH numeric>Average cost per piece</TH>
            <TH numeric>Value</TH>
            {canRevalue && <TH />}
          </tr>
        </THead>
        <TBody>
          {r.rows.map((p) => (
            <tr key={p.id}>
              <TD>
                {p.name}
                <div className="text-muted-foreground font-mono text-xs">{p.sku}</div>
              </TD>
              <TD numeric>
                <Qty pieces={p.pieces} sizes={p.sizes} />
              </TD>
              <TD numeric>
                {p.averageCost ? (
                  <span className="tabular-nums">{formatKES(p.averageCost)}</span>
                ) : p.pieces > 0 ? (
                  <span className="text-warning">Not set</span>
                ) : (
                  "—"
                )}
              </TD>
              <TD numeric>{p.value ? <Money value={p.value} /> : "—"}</TD>
              {canRevalue && (
                <TD numeric>
                  {p.pieces > 0 && (
                    <RevalueButton
                      productId={p.id}
                      name={p.name}
                      pieces={p.pieces}
                      quantityText={formatQuantity(p.pieces, p.sizes)}
                      suggested={p.averageCost ? Number(p.averageCost).toString() : p.costPrice}
                      uncosted={!p.value}
                    />
                  )}
                </TD>
              )}
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
