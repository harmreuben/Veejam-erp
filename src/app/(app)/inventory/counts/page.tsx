import Link from "next/link";

import { formatDateTime, StatusBadge } from "@/components/format";
import { Page, PageHeader, Section } from "@/components/page";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCounts, listWarehouses } from "@/server/modules/inventory/queries";

import { StartCountForm } from "./count-forms";

export const metadata = { title: "Stock counts" };

export default async function CountsPage() {
  const user = await requireUser();
  const db = getDb();
  const actor = toActor(user);
  const [counts, warehouses] = await Promise.all([
    listCounts(db, actor),
    listWarehouses(db, actor, { activeOnly: true }),
  ]);

  return (
    <Page>
      <PageHeader
        title="Stock counts"
        description="Count what's physically on the shelves; posting sets the system to match. Use this for the opening stock on cut-over day."
      />
      {hasPermission(user, "inventory.count") && (
        <Section title="Start a count">
          <StartCountForm warehouses={warehouses} />
        </Section>
      )}
      <Table minWidth={640}>
        <THead>
          <tr>
            <TH>Number</TH>
            <TH>Warehouse</TH>
            <TH>Started</TH>
            <TH numeric>Products</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {counts.length === 0 && <EmptyRow colSpan={5}>No counts yet.</EmptyRow>}
          {counts.map((c) => (
            <tr key={c.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/inventory/counts/${c.id}`} className="text-primary font-medium hover:underline">
                  {c.number}
                </Link>
              </TD>
              <TD>{c.warehouse.name}</TD>
              <TD className="whitespace-nowrap">
                {formatDateTime(c.createdAt)}
                <div className="text-muted-foreground text-xs">{c.createdBy.fullName}</div>
              </TD>
              <TD numeric>{c._count.lines}</TD>
              <TD>
                <StatusBadge status={c.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
