import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param, STATUS_OPTIONS } from "@/components/filters";
import { Money, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import type { CustomerType, RecordStatus } from "@/generated/prisma/enums";
import { formatKenyanPhone } from "@/lib/phone";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { CUSTOMER_TYPE_LABELS } from "@/server/modules/customers/schemas";
import { listCustomers } from "@/server/modules/customers/service";

export const metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("customers.view");
  if (!user) return <NoAccess what="customers" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = (param(sp.status) ?? "ACTIVE") as RecordStatus | "ALL";
  const type = (param(sp.type) ?? "ALL") as CustomerType | "ALL";
  const customers = await listCustomers(getDb(), toActor(user), { q, status, type });

  return (
    <Page wide>
      <PageHeader
        title="Customers"
        description="Shops and businesses VeeJam sells to. Each has an account number used on every document."
        actions={
          hasPermission(user.role, "customers.manage") && (
            <Button asChild>
              <Link href="/customers/new">
                <Plus aria-hidden /> Add customer
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Name, account number, phone, town or KRA PIN"
        selects={[
          { name: "status", label: "Status", value: status, options: STATUS_OPTIONS },
          {
            name: "type",
            label: "Type",
            value: type,
            options: [
              { value: "ALL", label: "All types" },
              ...Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => ({ value, label })),
            ],
          },
        ]}
      />
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Customer</TH>
            <TH>Type</TH>
            <TH>Phone</TH>
            <TH>Town</TH>
            <TH numeric>Credit limit</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {customers.length === 0 && (
            <EmptyRow colSpan={6}>
              {q
                ? "No customers match that search."
                : "No customers yet. Add one, or import a list under Admin → Imports."}
            </EmptyRow>
          )}
          {customers.map((c) => (
            <tr key={c.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <div className="text-muted-foreground text-xs">{c.code}</div>
              </TD>
              <TD>{CUSTOMER_TYPE_LABELS[c.type]}</TD>
              <TD className="whitespace-nowrap">
                {c.phone ? formatKenyanPhone(c.phone) : <span className="text-muted-foreground">—</span>}
              </TD>
              <TD>{c.town ?? <span className="text-muted-foreground">—</span>}</TD>
              <TD numeric>
                {c.creditLimit === "0.00" ? (
                  <span className="text-muted-foreground">Cash</span>
                ) : (
                  <Money value={c.creditLimit} />
                )}
              </TD>
              <TD>
                <StatusBadge status={c.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
      {customers.length === 500 && (
        <p className="text-muted-foreground text-sm">Showing the first 500. Search to narrow down.</p>
      )}
    </Page>
  );
}
