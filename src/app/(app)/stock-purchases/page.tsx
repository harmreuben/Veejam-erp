import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDbDate } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listStockPurchases } from "@/server/modules/purchasing/stock-purchase";

export const metadata = { title: "Stock purchases" };

export default async function StockPurchasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="stock purchases" />;
  const q = param((await searchParams).q) ?? "";
  const rows = await listStockPurchases(getDb(), toActor(user), { q });
  const canRecord = hasPermission(user, "goods.receive") && hasPermission(user, "bills.manage");
  return (
    <Page wide>
      <PageHeader
        title="Stock purchases"
        description="Stock bought from suppliers. Each one puts the goods into stock at cost, and is either paid from Cash, M-Pesa or Bank or owed to the supplier. Stock is never an expense: its cost counts only when it's sold."
        actions={
          canRecord && (
            <Button asChild>
              <Link href="/stock-purchases/new">
                <Plus aria-hidden /> Record a purchase
              </Link>
            </Button>
          )
        }
      />
      <FilterBar q={q} placeholder="GRN number, supplier invoice or supplier" />
      <Table minWidth={820}>
        <THead>
          <tr>
            <TH>Number</TH>
            <TH>Date</TH>
            <TH>Supplier</TH>
            <TH>Supplier&apos;s invoice</TH>
            <TH numeric>Total</TH>
            <TH numeric>Still owed</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={6} art={q ? "search" : "cartons"}>
              {q ? "Nothing matches that search." : "No stock purchases yet."}
            </EmptyRow>
          )}
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-muted/50">
              <TD className="whitespace-nowrap">
                <Link
                  href={`/stock-purchases/${r.id}`}
                  className="text-link font-mono font-medium hover:underline"
                >
                  {r.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(toDbDate(r.date))}</TD>
              <TD className="min-w-44">{r.supplier.name}</TD>
              <TD className="font-mono text-xs">{r.supplierReference}</TD>
              <TD numeric>
                <Money value={r.total} />
              </TD>
              <TD numeric>
                {toDecimal(r.owed).greaterThan(0) ? (
                  <Money value={r.owed} />
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
