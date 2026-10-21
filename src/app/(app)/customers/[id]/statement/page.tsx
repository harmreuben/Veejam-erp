import Link from "next/link";
import { notFound } from "next/navigation";

import { param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDbDate } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { customerStatement } from "@/server/modules/payments/service";
import { isUuid } from "@/server/shared/validation";

export const metadata = { title: "Statement" };

const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("customers.view");
  if (!user) return <NoAccess what="customer statements" />;
  const id = (await params).id;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const from = day(param(sp.from));
  const to = day(param(sp.to));
  const st = await customerStatement(getDb(), toActor(user), id, { from, to }).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const closing = toDecimal(st.closing);
  return (
    <Page wide>
      <PageHeader
        back={{ href: `/customers/${id}`, label: st.customer.name }}
        title={`Statement — ${st.customer.name}`}
        description={
          <>
            {st.customer.code}
            {from ? ` · from ${formatDate(toDbDate(from))}` : ""} · to {formatDate(toDbDate(st.to))}.{" "}
            {closing.greaterThan(0) ? (
              <>
                Owes <Money value={st.closing} />.
              </>
            ) : closing.lessThan(0) ? (
              <>
                In credit by <Money value={closing.negated().toFixed(2)} />.
              </>
            ) : (
              "Nothing owed."
            )}
          </>
        }
        actions={
          hasPermission(user.role, "payments.record") && (
            <Button asChild>
              <Link href={`/payments/new?customer=${id}`}>Record payment</Link>
            </Button>
          )
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
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Date</TH>
            <TH>What</TH>
            <TH>Reference</TH>
            <TH numeric>Charged</TH>
            <TH numeric>Paid / credited</TH>
            <TH numeric>Balance</TH>
          </tr>
        </THead>
        <TBody>
          {from && (
            <tr className="bg-muted/30">
              <TD>{formatDate(toDbDate(from))}</TD>
              <TD colSpan={4}>Balance brought forward</TD>
              <TD numeric>
                <Money value={st.opening} />
              </TD>
            </tr>
          )}
          {st.lines.length === 0 && (
            <tr>
              <TD colSpan={6} className="text-muted-foreground">
                Nothing in this period.
              </TD>
            </tr>
          )}
          {st.lines.map((l, i) => (
            <tr key={i}>
              <TD className="whitespace-nowrap">{formatDate(toDbDate(l.date))}</TD>
              <TD>{l.kind}</TD>
              <TD>
                {l.href ? (
                  <Link href={l.href} className="hover:underline">
                    {l.reference}
                  </Link>
                ) : (
                  l.reference
                )}
              </TD>
              <TD numeric>{toDecimal(l.debit).isZero() ? "" : <Money value={l.debit} />}</TD>
              <TD numeric>{toDecimal(l.credit).isZero() ? "" : <Money value={l.credit} />}</TD>
              <TD numeric className="font-medium">
                <Money value={l.balance} />
              </TD>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <TD colSpan={3}>Totals</TD>
            <TD numeric>
              <Money value={st.totalDebit} />
            </TD>
            <TD numeric>
              <Money value={st.totalCredit} />
            </TD>
            <TD numeric>
              <Money value={st.closing} />
            </TD>
          </tr>
        </TBody>
      </Table>
    </Page>
  );
}
