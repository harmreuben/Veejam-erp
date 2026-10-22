import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param, STATUS_OPTIONS } from "@/components/filters";
import { Money, Qty, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import type { RecordStatus } from "@/generated/prisma/enums";
import { formatKES } from "@/lib/money";
import { UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listProducts } from "@/server/modules/catalogue/service";

export const metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("catalogue.view");
  if (!user) return <NoAccess what="products" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = (param(sp.status) ?? "ACTIVE") as RecordStatus | "ALL";
  const products = await listProducts(getDb(), toActor(user), { q, status });
  const showCost = hasPermission(user, "catalogue.costs");

  return (
    <Page wide>
      <PageHeader
        title="Products"
        description="Every sellable item (SKU) with its pack sizes. Stock is counted in pieces."
        actions={
          hasPermission(user, "catalogue.manage") && (
            <Button asChild>
              <Link href="/products/new">
                <Plus aria-hidden /> Add product
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Name, SKU, brand, category or barcode"
        selects={[{ name: "status", label: "Status", value: status, options: STATUS_OPTIONS }]}
      />
      <Table minWidth={980}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH>Brand / category</TH>
            <TH numeric>Pack sizes</TH>
            <TH numeric>Selling prices (incl. VAT)</TH>
            {showCost && <TH numeric>Cost / piece</TH>}
            <TH numeric>In stock</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {products.length === 0 && (
            <EmptyRow colSpan={showCost ? 7 : 6}>
              {q
                ? "No products match that search."
                : "No products yet. Add one, or import your product list under Admin → Imports."}
            </EmptyRow>
          )}
          {products.map((p) => (
            <tr key={p.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                  {p.name}
                </Link>
                <div className="text-muted-foreground text-xs">{p.sku}</div>
              </TD>
              <TD>
                {p.brand}
                <div className="text-muted-foreground text-xs">{p.category}</div>
              </TD>
              <TD numeric className="text-xs">
                {p.unitsPerPack} pcs/pk
                <div className="text-muted-foreground">{p.packsPerCarton} pk/ctn</div>
              </TD>
              <TD numeric className="text-xs whitespace-nowrap">
                {p.priceLists.length === 0 ? (
                  <span className="text-warning">No price</span>
                ) : (
                  p.priceLists.map((l) => (
                    <div key={l.list}>
                      <span className="text-muted-foreground">{l.list.replace(/ prices$/i, "")}: </span>
                      {l.prices.map((x) => `${formatKES(x.price)} /${UNIT_LABELS[x.unit].short}`).join(" · ")}
                    </div>
                  ))
                )}
              </TD>
              {showCost && (
                <TD numeric>
                  {p.costPrice ? (
                    <Money value={p.costPrice} />
                  ) : (
                    <span className="text-warning text-xs">Not set</span>
                  )}
                </TD>
              )}
              <TD numeric>
                <Qty pieces={p.onHand} sizes={p} />
                {p.lowStock && (
                  <div>
                    <Badge variant="warning">Low</Badge>
                  </div>
                )}
              </TD>
              <TD>
                <StatusBadge status={p.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
