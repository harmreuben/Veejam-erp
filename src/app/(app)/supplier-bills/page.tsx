import Link from "next/link";
import { Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatShortDay } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listBills } from "@/server/modules/purchasing/payables";

import { BillStateBadge } from "../_purchasing/ui";

export const metadata = { title: "Supplier bills" };

export default async function SupplierBillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier bills" />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = param(sp.status) ?? "UNPAID";
  const rows = await listBills(getDb(), toActor(user), { q, status: status === "ALL" ? undefined : status });
  const owed = rows.reduce((s, r) => s.plus(r.outstanding), toDecimal(0));
  return (
    <Page wide>
      <PageHeader
        title="Supplier bills"
        description={
          <>
            Suppliers&apos; invoices, entered when they arrive.{" "}
            {status === "UNPAID" && (
              <>
                Unpaid now: <Money value={owed.toFixed(2)} />.
              </>
            )}
          </>
        }
        actions={
          hasPermission(user, "bills.manage") && (
            <Button asChild>
              <Link href="/supplier-bills/new">
                <Plus aria-hidden /> Enter a bill
              </Link>
            </Button>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Bill, supplier's invoice number or supplier"
        selects={[
          {
            name: "status",
            label: "Show",
            value: status,
            options: [
              { value: "UNPAID", label: "Not fully paid" },
              { value: "ALL", label: "All" },
              { value: "CANCELLED", label: "Cancelled" },
            ],
          },
        ]}
      />
      <Table minWidth={820}>
        <THead>
          <tr>
            <TH>Bill</TH>
            <TH>Supplier</TH>
            <TH>Invoice date</TH>
            <TH>Due</TH>
            <TH numeric>Total</TH>
            <TH numeric>Still to pay</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={7} art={q ? "search" : "documents"}>
              {q ? "Nothing matches that search." : "No bills here."}
            </EmptyRow>
          )}
          {rows.map((b) => (
            <tr key={b.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`/supplier-bills/${b.id}`} className="text-primary font-medium hover:underline">
                  {b.number}
                </Link>
                <div className="text-muted-foreground font-mono text-xs">{b.supplierInvoiceNumber}</div>
              </TD>
              <TD>{b.supplier}</TD>
              <TD className="whitespace-nowrap">{formatShortDay(b.billDate)}</TD>
              <TD className="whitespace-nowrap">{formatShortDay(b.dueDate)}</TD>
              <TD numeric>
                <Money value={b.total} />
              </TD>
              <TD numeric>
                {toDecimal(b.outstanding).greaterThan(0) ? <Money value={b.outstanding} /> : ""}
              </TD>
              <TD>
                <BillStateBadge state={b.state} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
