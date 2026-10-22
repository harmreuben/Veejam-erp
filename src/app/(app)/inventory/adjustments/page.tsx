import Link from "next/link";
import { Plus } from "lucide-react";

import { formatDateTime } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listAdjustments } from "@/server/modules/inventory/queries";
import { ADJUSTMENT_REASON_LABELS } from "@/server/modules/inventory/schemas";

export const metadata = { title: "Stock adjustments" };

export default async function AdjustmentsPage() {
  const user = await requireUser();
  const rows = await listAdjustments(getDb(), toActor(user));
  return (
    <Page>
      <PageHeader
        title="Stock adjustments"
        description="Opening balances, damages, expiries, losses and finds. Posting one needs an owner or administrator."
        actions={
          hasPermission(user, "inventory.adjust") && (
            <Button asChild>
              <Link href="/inventory/adjustments/new">
                <Plus aria-hidden /> New adjustment
              </Link>
            </Button>
          )
        }
      />
      <Table minWidth={640}>
        <THead>
          <tr>
            <TH>Number</TH>
            <TH>Posted</TH>
            <TH>Warehouse</TH>
            <TH>Reason</TH>
            <TH numeric>Lines</TH>
            <TH>By</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={6}>No adjustments yet.</EmptyRow>}
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-muted/50">
              <TD>
                <Link
                  href={`/inventory/adjustments/${a.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {a.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDateTime(a.postedAt)}</TD>
              <TD>{a.warehouse.name}</TD>
              <TD>{ADJUSTMENT_REASON_LABELS[a.reason]}</TD>
              <TD numeric>{a._count.lines}</TD>
              <TD className="text-muted-foreground">{a.postedBy.fullName}</TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
