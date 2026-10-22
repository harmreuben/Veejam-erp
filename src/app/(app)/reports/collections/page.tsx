import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { collectionsReport } from "@/server/modules/reports/service";

import { RangeError, Stat } from "../_components/stat";
import { rangeFrom } from "../_components/read";
import { RangeFilter } from "../_components/range-filter";

export const metadata = { title: "Money received" };

const METHODS = ["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE"] as const;

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("reports.view");
  if (!user) return <NoAccess what="reports" />;
  const { range, error } = rangeFrom(await searchParams);
  const r = await collectionsReport(getDb(), toActor(user), range);

  return (
    <Page wide>
      <PageHeader
        title="Money received"
        description="Customer payments by the day they were received. Reversed payments are left out and shown separately."
      />
      <RangeFilter path="/reports/collections" range={range} csv="collections" />
      <RangeError message={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Total received"
          value={formatKES(r.total)}
          note={`${r.count} payment${r.count === 1 ? "" : "s"}`}
        />
        {METHODS.map((m) => (
          <Stat key={m} label={METHOD_LABELS[m]} value={formatKES(r.methodTotals[m])} />
        ))}
      </div>
      {toDecimal(r.reversed).greaterThan(0) && (
        <p className="text-muted-foreground text-sm">Reversed in this period: {formatKES(r.reversed)}.</p>
      )}
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Date</TH>
            {METHODS.map((m) => (
              <TH key={m} numeric>
                {METHOD_LABELS[m]}
              </TH>
            ))}
            <TH numeric>Total</TH>
          </tr>
        </THead>
        <TBody>
          {r.rows.length === 0 && <EmptyRow colSpan={6}>No payments in this period.</EmptyRow>}
          {r.rows.map((row) => (
            <tr key={row.day}>
              <TD>{formatLongDay(row.day)}</TD>
              {METHODS.map((m) => (
                <TD key={m} numeric>
                  {row.byMethod[m] !== "0.00" ? <Money value={row.byMethod[m]} /> : ""}
                </TD>
              ))}
              <TD numeric className="font-medium">
                <Money value={row.total} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
