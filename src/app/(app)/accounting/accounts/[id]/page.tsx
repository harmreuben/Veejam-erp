import Link from "next/link";
import { notFound } from "next/navigation";

import { param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDbDate } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { ACCOUNT_TYPE_LABELS, accountLedger } from "@/server/modules/accounting/service";

export const metadata = { title: "Account" };

const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const sp = await searchParams;
  const from = day(param(sp.from));
  const to = day(param(sp.to));
  const l = await accountLedger(getDb(), toActor(user), (await params).id, { from, to }).catch(
    (e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    },
  );
  return (
    <Page wide>
      <PageHeader
        back={{ href: "/accounting", label: "Trial balance" }}
        title={`${l.account.code} ${l.account.name}`}
        description={
          <>
            {ACCOUNT_TYPE_LABELS[l.account.type]} · balance at {formatDate(toDbDate(l.to))}:{" "}
            <Money value={l.closing} />
          </>
        }
      />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">From</span>
          <Input type="date" name="from" defaultValue={from} />
        </label>
        <label className="grid gap-1 text-xs">
          <span className="text-muted-foreground">To</span>
          <Input type="date" name="to" defaultValue={to} />
        </label>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      <Table minWidth={820}>
        <THead>
          <tr>
            <TH>Date</TH>
            <TH>Entry</TH>
            <TH>Description</TH>
            <TH numeric>Debit</TH>
            <TH numeric>Credit</TH>
            <TH numeric>Balance</TH>
          </tr>
        </THead>
        <TBody>
          {from && (
            <tr className="bg-muted/30">
              <TD colSpan={5}>Opening balance</TD>
              <TD numeric>
                <Money value={l.opening} />
              </TD>
            </tr>
          )}
          {l.lines.length === 0 && (
            <tr>
              <TD colSpan={6} className="text-muted-foreground">
                No entries in this period.
              </TD>
            </tr>
          )}
          {l.lines.map((x) => (
            <tr key={x.id}>
              <TD className="whitespace-nowrap">{formatDate(toDbDate(x.date))}</TD>
              <TD>
                <Link href={`/accounting/journal/${x.entry.id}`} className="text-primary hover:underline">
                  {x.entry.number}
                </Link>
              </TD>
              <TD>
                {x.description}
                {x.customer && <div className="text-muted-foreground text-xs">{x.customer.name}</div>}
              </TD>
              <TD numeric>{toDecimal(x.debit).isZero() ? "" : <Money value={x.debit} />}</TD>
              <TD numeric>{toDecimal(x.credit).isZero() ? "" : <Money value={x.credit} />}</TD>
              <TD numeric className="font-medium">
                <Money value={x.balance} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
