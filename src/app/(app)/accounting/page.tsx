import Link from "next/link";

import { param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDbDate, todayInNairobi } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ACCOUNT_TYPE_LABELS, accountingStatus, trialBalance } from "@/server/modules/accounting/service";

import { StartAccountingButton } from "./forms";

export const metadata = { title: "Trial balance" };

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const db = getDb();
  const asOfParam = param((await searchParams).asOf);
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? asOfParam : todayInNairobi();
  const [status, tb] = await Promise.all([accountingStatus(db), trialBalance(db, toActor(user), asOf)]);
  const stockGap = toDecimal(status.inventoryNotInBooks);
  const needsStart = status.openingNeeded || status.invoicesWithoutJournal > 0 || !stockGap.isZero();
  const groups = (["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const).map((t) => ({
    type: t,
    rows: tb.rows.filter((r) => r.type === t),
  }));
  return (
    <Page wide>
      <PageHeader
        title="Trial balance"
        description={
          <>
            Every account&apos;s balance at the end of {formatDate(toDbDate(asOf))}. Sales, purchases,
            payments and stock movements post here automatically; other income and expenses go in as journal
            entries.
          </>
        }
        actions={
          hasPermission(user, "accounting.journal") && (
            <Button asChild>
              <Link href="/accounting/journal/new">New journal entry</Link>
            </Button>
          )
        }
      />
      {needsStart && (
        <div
          role="status"
          className="border-warning/40 bg-warning-soft grid gap-3 rounded-md border p-4 text-sm"
        >
          <p>
            <strong>Start the books.</strong>{" "}
            {status.openingNeeded &&
              "What customers still owed on the old system's invoices goes in as one opening entry. "}
            {status.invoicesWithoutJournal > 0 &&
              `${status.invoicesWithoutJournal} invoice(s) posted before accounting was set up will be added to the journal. `}
            {!stockGap.isZero() &&
              `Stock on hand worth ${formatKES(stockGap.abs().toFixed(2))} (at cost) isn't in the Inventory account yet; it goes in as an opening balance. `}
            Until then, the figures below are incomplete.
          </p>
          {hasPermission(user, "accounting.close") ? (
            <StartAccountingButton />
          ) : (
            <p className="text-muted-foreground">An owner or administrator needs to do this.</p>
          )}
        </div>
      )}
      <form method="get" className="flex items-end gap-2">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">As at</span>
          <Input type="date" name="asOf" defaultValue={asOf} />
        </label>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      <Table minWidth={720}>
        <THead>
          <tr>
            <TH>Account</TH>
            <TH numeric>Debit</TH>
            <TH numeric>Credit</TH>
          </tr>
        </THead>
        <TBody>
          {groups.map((g) => (
            <GroupRows key={g.type} label={ACCOUNT_TYPE_LABELS[g.type]} rows={g.rows} />
          ))}
          <tr className="bg-muted/40 font-semibold">
            <TD>Totals {tb.balanced ? "" : "— do not balance"}</TD>
            <TD numeric>
              <Money value={tb.totalDebit} />
            </TD>
            <TD numeric>
              <Money value={tb.totalCredit} />
            </TD>
          </tr>
        </TBody>
      </Table>
      <p className="text-sm">
        Income less expenses to date:{" "}
        <strong className={toDecimal(tb.profit).lessThan(0) ? "text-destructive" : undefined}>
          <Money value={tb.profit} />
        </strong>
        . Cost of goods sold is taken at average cost with every sale.
      </p>
    </Page>
  );
}

function GroupRows({
  label,
  rows,
}: {
  label: string;
  rows: {
    id: string;
    code: string;
    name: string;
    tbDebit: string;
    tbCredit: string;
    debit: string;
    credit: string;
  }[];
}) {
  return (
    <>
      <tr>
        <TD colSpan={3} className="text-muted-foreground pt-4 text-xs font-semibold tracking-wide uppercase">
          {label}
        </TD>
      </tr>
      {rows.map((r) => {
        const empty = toDecimal(r.debit).isZero() && toDecimal(r.credit).isZero();
        return (
          <tr key={r.id} className={empty ? "text-muted-foreground" : undefined}>
            <TD>
              <Link href={`/accounting/accounts/${r.id}`} className="hover:underline">
                <span className="font-mono text-xs">{r.code}</span> {r.name}
              </Link>
            </TD>
            <TD numeric>{toDecimal(r.tbDebit).isZero() ? "" : <Money value={r.tbDebit} />}</TD>
            <TD numeric>{toDecimal(r.tbCredit).isZero() ? "" : <Money value={r.tbCredit} />}</TD>
          </tr>
        );
      })}
    </>
  );
}
