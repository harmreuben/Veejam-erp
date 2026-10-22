import Link from "next/link";
import { notFound } from "next/navigation";

import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatShortDay } from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { supplierStatement } from "@/server/modules/purchasing/payables";

export const metadata = { title: "Supplier statement" };

export default async function SupplierStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier statements" />;
  const r = await supplierStatement(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const bal = toDecimal(r.balance);
  return (
    <Page wide>
      <PageHeader
        back={{ href: `/suppliers/${r.supplier.id}`, label: r.supplier.name }}
        title={`Statement — ${r.supplier.name}`}
        description={
          <>
            {r.supplier.code} ·{" "}
            {bal.isZero()
              ? "Nothing owed."
              : bal.lessThan(0)
                ? `Paid in advance: ${formatKES(bal.abs().toFixed(2))}.`
                : `We owe ${formatKES(r.balance)}.`}{" "}
            Compare with the supplier&apos;s own statement.
          </>
        }
      />
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Date</TH>
            <TH>What</TH>
            <TH>Reference</TH>
            <TH numeric>Billed</TH>
            <TH numeric>Paid</TH>
            <TH numeric>Balance</TH>
          </tr>
        </THead>
        <TBody>
          {r.rows.length === 0 && <EmptyRow colSpan={6}>No bills or payments yet.</EmptyRow>}
          {r.rows.map((e) => (
            <tr key={`${e.kind}-${e.id}`}>
              <TD className="whitespace-nowrap">{formatShortDay(e.date)}</TD>
              <TD>{e.kind}</TD>
              <TD>
                <Link
                  href={e.kind === "Bill" ? `/supplier-bills/${e.id}` : `/supplier-payments/${e.id}`}
                  className="text-primary hover:underline"
                >
                  {e.reference}
                </Link>
              </TD>
              <TD numeric>{toDecimal(e.charged).isZero() ? "" : <Money value={e.charged} />}</TD>
              <TD numeric>{toDecimal(e.paid).isZero() ? "" : <Money value={e.paid} />}</TD>
              <TD numeric>
                <Money value={e.balance} />
              </TD>
            </tr>
          ))}
          {r.rows.length > 0 && (
            <tr className="font-semibold">
              <TD colSpan={3}>Totals</TD>
              <TD numeric>
                <Money value={r.totals.charged} />
              </TD>
              <TD numeric>
                <Money value={r.totals.paid} />
              </TD>
              <TD numeric>
                <Money value={r.balance} />
              </TD>
            </tr>
          )}
        </TBody>
      </Table>
    </Page>
  );
}
