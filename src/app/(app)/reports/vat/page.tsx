import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { endOfMonth, formatMonth, startOfMonth, startOfPreviousMonth, todayInNairobi } from "@/lib/dates";
import { formatKES } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { TAX_CATEGORY_LABELS } from "@/server/modules/sales/extras";
import { vatReport } from "@/server/modules/reports/service";

import { RangeError, Stat } from "../_components/stat";
import { rangeFrom } from "../_components/read";
import { RangeFilter } from "../_components/range-filter";

export const metadata = { title: "VAT report" };

export default async function VatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("reports.view");
  if (!user) return <NoAccess what="reports" />;
  const today = todayInNairobi();
  // VAT returns are monthly, so default to last month.
  const last = startOfPreviousMonth(today);
  const { range, error } = rangeFrom(await searchParams, { from: last, to: endOfMonth(last) });
  const r = await vatReport(getDb(), toActor(user), range);

  return (
    <Page wide>
      <PageHeader
        title="VAT"
        description={
          <>
            Output VAT on posted invoices less credit notes, by month and rate. Input VAT on purchases arrives
            with purchasing (Phase 5b). Check figures against iTax before filing; this is a management report,
            not a return. Current month so far: {formatMonth(startOfMonth(today))}.
          </>
        }
      />
      <RangeFilter path="/reports/vat" range={range} csv="vat" />
      <RangeError message={error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Taxable sales (excl. VAT)" value={formatKES(r.totals.salesNet)} />
        <Stat label="VAT on credit notes" value={formatKES(r.totals.returnsVat)} />
        <Stat label="Net output VAT" value={formatKES(r.totals.netVat)} />
      </div>
      <Table minWidth={820}>
        <THead>
          <tr>
            <TH>Month</TH>
            <TH>Category</TH>
            <TH numeric>Rate</TH>
            <TH numeric>Sales excl. VAT</TH>
            <TH numeric>Output VAT</TH>
            <TH numeric>Returns excl. VAT</TH>
            <TH numeric>VAT on returns</TH>
            <TH numeric>Net VAT</TH>
          </tr>
        </THead>
        <TBody>
          {r.rows.length === 0 && <EmptyRow colSpan={8}>No sales in this period.</EmptyRow>}
          {r.rows.map((row) => (
            <tr key={`${row.month}-${row.category}-${row.rate}`}>
              <TD>{formatMonth(row.month)}</TD>
              <TD>{TAX_CATEGORY_LABELS[row.category as keyof typeof TAX_CATEGORY_LABELS] ?? row.category}</TD>
              <TD numeric>{row.rate}%</TD>
              <TD numeric>
                <Money value={row.salesNet} />
              </TD>
              <TD numeric>
                <Money value={row.salesVat} />
              </TD>
              <TD numeric>
                <Money value={row.returnsNet} />
              </TD>
              <TD numeric>
                <Money value={row.returnsVat} />
              </TD>
              <TD numeric className="font-medium">
                <Money value={row.netVat} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
