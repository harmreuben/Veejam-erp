import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listJournal } from "@/server/modules/accounting/service";

import { SOURCE_LABELS } from "../labels";

export const metadata = { title: "Journal" };

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const source = param(sp.source) ?? "ALL";
  const rows = await listJournal(getDb(), toActor(user), { q, source });
  return (
    <Page wide>
      <PageHeader
        title="Journal"
        description="Every entry in date order. Entries can't be edited or deleted; mistakes are corrected with another entry."
        actions={
          hasPermission(user, "accounting.journal") && (
            <Button asChild>
              <Link href="/accounting/journal/new">
                <Plus aria-hidden /> New journal entry
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Entry number, description or document number"
        selects={[
          {
            name: "source",
            label: "From",
            value: source,
            options: [
              { value: "ALL", label: "Everything" },
              ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
      />
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Entry</TH>
            <TH>Date</TH>
            <TH>Description</TH>
            <TH>From</TH>
            <TH numeric>Amount</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={5} art="documents">
              No entries yet.
            </EmptyRow>
          )}
          {rows.map((e) => (
            <tr key={e.id} className="hover:bg-muted/50">
              <TD>
                <Link
                  href={`/accounting/journal/${e.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {e.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(e.date)}</TD>
              <TD>{e.description}</TD>
              <TD className="text-muted-foreground">{SOURCE_LABELS[e.sourceType] ?? e.sourceType}</TD>
              <TD numeric>
                <Money value={e.amount} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
