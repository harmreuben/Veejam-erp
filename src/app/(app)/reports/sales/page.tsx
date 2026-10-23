import Link from "next/link";

import { BarList, Columns } from "@/components/charts";
import { param } from "@/components/filters";
import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay, formatMonth, formatShortDay } from "@/lib/dates";
import { formatKES } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { salesReport, SALES_GROUPS, type SalesGroup } from "@/server/modules/reports/service";

import { RangeError, Stat } from "../_components/stat";
import { rangeFrom } from "../_components/read";
import { RangeFilter } from "../_components/range-filter";

export const metadata = { title: "Sales report" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default async function SalesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("reports.view");
  if (!user) return <NoAccess what="reports" />;
  const sp = await searchParams;
  const { range, error } = rangeFrom(sp);
  const g = param(sp.group);
  const group: SalesGroup = g && g in SALES_GROUPS ? (g as SalesGroup) : "day";
  const { rows, totals } = await salesReport(getDb(), toActor(user), range, group);
  const label = (k: string) => (group === "day" ? formatLongDay(k) : group === "month" ? formatMonth(k) : k);

  return (
    <Page wide>
      <PageHeader
        title="Sales"
        description="Posted invoices by their date, less credit notes by theirs. Old-system invoices are included."
      />
      <RangeFilter
        path="/reports/sales"
        range={range}
        csv="sales"
        select={{
          name: "group",
          label: "Group by",
          value: group,
          options: Object.entries(SALES_GROUPS).map(([value, label]) => ({ value, label })),
        }}
      />
      <RangeError message={error} />
      <div className="vj-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Invoiced (incl. VAT)"
          value={formatKES(totals.gross)}
          note={plural(totals.invoices, "invoice")}
        />
        <Stat
          label="Credit notes"
          value={formatKES(totals.returnsGross)}
          note={plural(totals.creditNotes, "credit note")}
        />
        <Stat label="Net sales (incl. VAT)" value={formatKES(totals.netGross)} />
        <Stat
          label="Net sales (excl. VAT)"
          value={formatKES(totals.netSales)}
          note={`VAT ${formatKES(totals.vat)} invoiced`}
        />
      </div>
      {rows.length > 0 &&
        (group === "day" || group === "month" ? (
          rows.length > 1 && (
            <Columns
              label={`Net sales by ${group}`}
              points={rows.map((r) => ({
                key: r.key,
                label: group === "day" ? formatShortDay(r.label) : formatMonth(r.label),
                value: r.netGross,
              }))}
            />
          )
        ) : (
          <BarList
            items={[...rows]
              .sort((a, b) => Number(b.netGross) - Number(a.netGross))
              .slice(0, 10)
              .map((r) => ({
                key: r.key,
                label: r.label,
                sub: r.sub ?? undefined,
                href: r.href ?? undefined,
                value: r.netGross,
                note: plural(r.documents, "invoice"),
              }))}
            empty=""
          />
        ))}
      <Table minWidth={820}>
        <THead>
          <tr>
            <TH>{SALES_GROUPS[group]}</TH>
            <TH numeric>Invoices</TH>
            {group === "product" && <TH numeric>Pieces (net)</TH>}
            <TH numeric>Excl. VAT</TH>
            <TH numeric>VAT</TH>
            <TH numeric>Credit notes</TH>
            <TH numeric>Net incl. VAT</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={group === "product" ? 7 : 6} art="chart">
              No sales in this period.
            </EmptyRow>
          )}
          {rows.map((r) => (
            <tr key={r.key}>
              <TD>
                {r.href ? (
                  <Link href={r.href} className="hover:underline">
                    {label(r.label)}
                  </Link>
                ) : (
                  label(r.label)
                )}
                {r.sub && <div className="text-muted-foreground font-mono text-xs">{r.sub}</div>}
              </TD>
              <TD numeric>{r.documents}</TD>
              {group === "product" && <TD numeric>{r.pieces?.toLocaleString("en-KE")}</TD>}
              <TD numeric>
                <Money value={r.net} />
              </TD>
              <TD numeric>
                <Money value={r.vat} />
              </TD>
              <TD numeric>{r.returnsGross !== "0.00" ? <Money value={r.returnsGross} /> : ""}</TD>
              <TD numeric className="font-medium">
                <Money value={r.netGross} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
