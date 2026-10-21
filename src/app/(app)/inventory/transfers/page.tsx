import Link from "next/link";
import { Plus } from "lucide-react";

import { formatDateTime } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listTransfers } from "@/server/modules/inventory/queries";

export const metadata = { title: "Stock transfers" };

export default async function TransfersPage() {
  const user = await requireUser();
  const rows = await listTransfers(getDb(), toActor(user));
  return (
    <Page>
      <PageHeader
        title="Stock transfers"
        description="Moving stock between warehouses, for example from the main store to a delivery van."
        actions={
          hasPermission(user.role, "inventory.transfer") && (
            <Button asChild>
              <Link href="/inventory/transfers/new">
                <Plus aria-hidden /> New transfer
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
            <TH>From → to</TH>
            <TH numeric>Lines</TH>
            <TH>By</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={5}>No transfers yet.</EmptyRow>}
          {rows.map((t) => (
            <tr key={t.id} className="hover:bg-muted/50">
              <TD>
                <Link
                  href={`/inventory/transfers/${t.id}`}
                  className="text-primary font-medium hover:underline"
                >
                  {t.number}
                </Link>
              </TD>
              <TD className="whitespace-nowrap">{formatDateTime(t.postedAt)}</TD>
              <TD>
                {t.fromWarehouse.name} → {t.toWarehouse.name}
              </TD>
              <TD numeric>{t._count.lines}</TD>
              <TD className="text-muted-foreground">{t.postedBy.fullName}</TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
