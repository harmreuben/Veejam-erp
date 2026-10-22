import { Download } from "lucide-react";

import { Money, Qty } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatKES } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { stockValuation } from "@/server/modules/reports/service";

import { Stat } from "../_components/stat";

export const metadata = { title: "Stock value" };

export default async function StockValuePage() {
  const user = await pageUser("reports.view");
  if (!user || !hasPermission(user.role, "catalogue.costs")) return <NoAccess what="cost prices" />;
  const r = await stockValuation(getDb(), toActor(user));
  return (
    <Page wide>
      <PageHeader
        title="Stock value"
        description="Pieces on hand now, at each product's cost price (excluding VAT). Set cost prices on the product pages; purchasing (Phase 5b) will keep them up to date."
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
          label="Products without a cost price"
          value={String(r.missing)}
          note={
            r.missing ? "Their stock is left out of the total above." : "Every product with stock is costed."
          }
        />
      </div>
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>On hand</TH>
            <TH numeric>Cost per piece</TH>
            <TH numeric>Value</TH>
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
                {p.costPrice ? <Money value={p.costPrice} /> : <span className="text-warning">Not set</span>}
              </TD>
              <TD numeric>{p.value ? <Money value={p.value} /> : "—"}</TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
