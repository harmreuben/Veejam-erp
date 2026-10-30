import Link from "next/link";

import { BarList } from "@/components/charts";
import { formatDate, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { addDays, toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES } from "@/lib/money";
import { UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { salesReturns } from "@/server/modules/sales/returns";

import { rangeFrom } from "../reports/_components/read";
import { RangeFilter } from "../reports/_components/range-filter";
import { RangeError, Stat } from "../reports/_components/stat";

export const metadata = { title: "Sales returns" };

/**
 * Goods that came back from customers. A return is recorded as a credit note
 * with "put them back into stock" ticked, so this page reads those; it never
 * records anything itself. To record a return, credit the invoice.
 */
export default async function SalesReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="sales returns" />;
  const today = todayInNairobi();
  const { range, error } = rangeFrom(await searchParams, { from: addDays(today, -89), to: today });
  const r = await salesReturns(getDb(), toActor(user), range);
  const canCredit = hasPermission(user, "credit_notes.manage");
  const showCost = hasPermission(user, "catalogue.costs");

  return (
    <Page wide>
      <PageHeader
        title="Sales returns"
        description="Goods customers sent back that went back into stock. A return is a credit note on the invoice with “put them back into stock” ticked; credit notes without goods coming back are under Credit notes."
        actions={
          canCredit && (
            <Button asChild>
              <Link href="/invoices?status=POSTED">Record a return…</Link>
            </Button>
          )
        }
      />
      <RangeFilter path="/sales-returns" range={range} />
      <RangeError message={error} />
      <div className="vj-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Returns" value={String(r.count)} note="credit notes with goods back" />
        <Stat label="Pieces back in stock" value={r.pieces.toLocaleString("en-KE")} />
        <Stat label="Credited (incl. VAT)" value={formatKES(r.value)} />
        {showCost && <Stat label="Back in stock at cost" value={formatKES(r.cost)} />}
      </div>

      {r.byProduct.length > 1 && (
        <Section title="Returned most" description="By value credited, incl. VAT.">
          <BarList
            empty=""
            items={r.byProduct.slice(0, 8).map((p) => ({
              key: p.id,
              label: p.label,
              sub: p.sku,
              href: `/products/${p.id}`,
              value: p.value,
              note: `${p.pieces.toLocaleString("en-KE")} pcs`,
            }))}
          />
        </Section>
      )}

      <Table minWidth={980}>
        <THead>
          <tr>
            <TH>Date</TH>
            <TH>Credit note</TH>
            <TH>Invoice</TH>
            <TH>Customer</TH>
            <TH>What came back</TH>
            <TH>Reason</TH>
            <TH numeric>Credited</TH>
          </tr>
        </THead>
        <TBody>
          {r.rows.length === 0 && (
            <EmptyRow colSpan={7} art="cartons">
              No goods were returned to stock in this period.
            </EmptyRow>
          )}
          {r.rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/50 align-top">
              <TD className="whitespace-nowrap">{formatDate(toDbDate(row.date))}</TD>
              <TD className="whitespace-nowrap">
                <Link
                  href={`/credit-notes/${row.id}`}
                  className="text-link font-mono font-medium hover:underline"
                >
                  {row.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">
                {row.invoice && (
                  <Link href={`/invoices/${row.invoice.id}`} className="text-link font-mono hover:underline">
                    {row.invoice.number}
                  </Link>
                )}
              </TD>
              <TD className="min-w-44">
                <Link href={`/customers/${row.customer.id}`} className="hover:underline">
                  {row.customer.name}
                </Link>
              </TD>
              <TD className="min-w-56">
                <ul className="grid gap-0.5">
                  {row.items.map((it, i) => (
                    <li key={i}>
                      <span className="font-mono">
                        {it.quantity}{" "}
                        {it.quantity === 1 ? UNIT_LABELS[it.unit].one : UNIT_LABELS[it.unit].many}
                      </span>{" "}
                      {it.description}
                    </li>
                  ))}
                </ul>
                <div className="text-muted-foreground text-xs">into {row.warehouse}</div>
              </TD>
              <TD className="text-muted-foreground min-w-48">{row.reason}</TD>
              <TD numeric>
                <Money value={row.total} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
