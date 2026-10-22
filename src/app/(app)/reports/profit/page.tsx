import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatKES, toDecimal } from "@/lib/money";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { profitAndLoss } from "@/server/modules/reports/service";

import { RangeError } from "../_components/stat";
import { rangeFrom } from "../_components/read";
import { RangeFilter } from "../_components/range-filter";

export const metadata = { title: "Profit and loss" };

export default async function ProfitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("reports.view");
  if (!user) return <NoAccess what="reports" />;
  const { range, error } = rangeFrom(await searchParams);
  const r = await profitAndLoss(getDb(), toActor(user), range);
  const negative = toDecimal(r.result).lessThan(0);

  return (
    <Page>
      <PageHeader
        title="Profit and loss"
        description="Income and expense accounts from the ledger for the period. Expenses appear once they are entered as journal entries."
      />
      {!r.cogsPosted && (
        <p className="bg-warning-soft text-foreground rounded-md p-3 text-sm">
          <strong>Not a true profit yet.</strong> The cost of the goods sold isn&apos;t recorded until
          purchasing and cost prices are built (Phase 5b), so this shows sales less expenses, not gross
          profit.
        </p>
      )}
      <RangeFilter path="/reports/profit" range={range} csv="profit" />
      <RangeError message={error} />
      <Table minWidth={480}>
        <THead>
          <tr>
            <TH>Account</TH>
            <TH numeric>Amount</TH>
          </tr>
        </THead>
        <TBody>
          <tr className="bg-muted/40">
            <TD colSpan={2} className="text-xs font-semibold tracking-wide uppercase">
              Income
            </TD>
          </tr>
          {r.income.length === 0 && <EmptyRow colSpan={2}>No income in this period.</EmptyRow>}
          {r.income.map((a) => (
            <tr key={a.code}>
              <TD>
                <span className="text-muted-foreground font-mono text-xs">{a.code}</span> {a.name}
              </TD>
              <TD numeric>
                <Money value={a.amount} />
              </TD>
            </tr>
          ))}
          <tr>
            <TD className="font-medium">Total income</TD>
            <TD numeric className="font-medium">
              <Money value={r.totalIncome} />
            </TD>
          </tr>
          <tr className="bg-muted/40">
            <TD colSpan={2} className="text-xs font-semibold tracking-wide uppercase">
              Expenses
            </TD>
          </tr>
          {r.expenses.length === 0 && <EmptyRow colSpan={2}>No expenses in this period.</EmptyRow>}
          {r.expenses.map((a) => (
            <tr key={a.code}>
              <TD>
                <span className="text-muted-foreground font-mono text-xs">{a.code}</span> {a.name}
              </TD>
              <TD numeric>
                <Money value={a.amount} />
              </TD>
            </tr>
          ))}
          <tr>
            <TD className="font-medium">Total expenses</TD>
            <TD numeric className="font-medium">
              <Money value={r.totalExpenses} />
            </TD>
          </tr>
          <tr className="border-t-2">
            <TD className="font-semibold">Income less expenses</TD>
            <TD numeric className={cn("font-semibold", negative && "text-destructive")}>
              {formatKES(r.result)}
            </TD>
          </tr>
        </TBody>
      </Table>
    </Page>
  );
}
