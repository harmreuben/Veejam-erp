import Link from "next/link";

import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { agedPayables } from "@/server/modules/purchasing/payables";

export const metadata = { title: "What we owe suppliers" };

const cell = (v: string) => (toDecimal(v).isZero() ? "" : <Money value={v} />);

export default async function OwedPage() {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier balances" />;
  const r = await agedPayables(getDb(), toActor(user));
  return (
    <Page wide>
      <PageHeader
        title="What we owe suppliers"
        description="Unpaid bills by how far past their due date they are, less money paid in advance."
      />
      <Table minWidth={900}>
        <THead>
          <tr>
            <TH>Supplier</TH>
            <TH numeric>Not due yet</TH>
            <TH numeric>1–30 days late</TH>
            <TH numeric>31–60</TH>
            <TH numeric>61–90</TH>
            <TH numeric>Over 90</TH>
            <TH numeric>Paid in advance</TH>
            <TH numeric>We owe</TH>
          </tr>
        </THead>
        <TBody>
          {r.rows.length === 0 && <EmptyRow colSpan={8}>Nothing is owed to suppliers.</EmptyRow>}
          {r.rows.map((s) => (
            <tr key={s.id}>
              <TD>
                <Link href={`/suppliers/${s.id}`} className="text-primary hover:underline">
                  {s.name}
                </Link>
              </TD>
              <TD numeric>{cell(s.current)}</TD>
              <TD numeric>{cell(s.d30)}</TD>
              <TD numeric>{cell(s.d60)}</TD>
              <TD numeric>{cell(s.d90)}</TD>
              <TD numeric>{cell(s.over90)}</TD>
              <TD numeric>{cell(s.advance)}</TD>
              <TD numeric className="font-medium">
                <Money value={s.total} />
              </TD>
            </tr>
          ))}
          {r.rows.length > 0 && (
            <tr className="font-semibold">
              <TD>Totals</TD>
              <TD numeric>{cell(r.totals.current)}</TD>
              <TD numeric>{cell(r.totals.d30)}</TD>
              <TD numeric>{cell(r.totals.d60)}</TD>
              <TD numeric>{cell(r.totals.d90)}</TD>
              <TD numeric>{cell(r.totals.over90)}</TD>
              <TD numeric>{cell(r.totals.advance)}</TD>
              <TD numeric>
                <Money value={r.totals.total} />
              </TD>
            </tr>
          )}
        </TBody>
      </Table>
    </Page>
  );
}
