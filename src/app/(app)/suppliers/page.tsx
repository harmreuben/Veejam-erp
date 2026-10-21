import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param, STATUS_OPTIONS } from "@/components/filters";
import { StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import type { RecordStatus } from "@/generated/prisma/enums";
import { formatKenyanPhone } from "@/lib/phone";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listSuppliers } from "@/server/modules/suppliers/service";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("suppliers.view");
  if (!user) return <NoAccess what="suppliers" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = (param(sp.status) ?? "ACTIVE") as RecordStatus | "ALL";
  const suppliers = await listSuppliers(getDb(), toActor(user), { q, status });

  return (
    <Page>
      <PageHeader
        title="Suppliers"
        description="Who VeeJam buys from. Purchase orders and goods received arrive in Phase 5."
        actions={
          hasPermission(user.role, "suppliers.manage") && (
            <Button asChild>
              <Link href="/suppliers/new">
                <Plus aria-hidden /> Add supplier
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Name, code, contact or phone"
        selects={[{ name: "status", label: "Status", value: status, options: STATUS_OPTIONS }]}
      />
      <Table minWidth={600}>
        <THead>
          <tr>
            <TH>Supplier</TH>
            <TH>Contact</TH>
            <TH numeric>Terms</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {suppliers.length === 0 && <EmptyRow colSpan={4}>No suppliers yet.</EmptyRow>}
          {suppliers.map((s) => (
            <tr key={s.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">
                  {s.name}
                </Link>
                <div className="text-muted-foreground text-xs">{s.code}</div>
              </TD>
              <TD>
                {s.contactPerson ?? "—"}
                {s.phone && <div className="text-muted-foreground text-xs">{formatKenyanPhone(s.phone)}</div>}
              </TD>
              <TD numeric>{s.paymentTermsDays ? `${s.paymentTermsDays} days` : "On delivery"}</TD>
              <TD>
                <StatusBadge status={s.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
