import Link from "next/link";
import { notFound } from "next/navigation";

import { Money, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { formatKES, toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { supplierBalance } from "@/server/modules/purchasing/payables";
import { getSupplier } from "@/server/modules/suppliers/service";

import { Stat } from "../../reports/_components/stat";

import { updateSupplierAction } from "../actions";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("suppliers.view");
  if (!user) return <NoAccess what="suppliers" />;
  const { id } = await params;
  const s = await getSupplier(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const db = getDb();
  const seePayables = hasPermission(user, "payables.view");
  const balance = seePayables ? await supplierBalance(db, s.id) : null;
  return (
    <Page>
      <PageHeader
        actions={
          <>
            {hasPermission(user, "goods.receive") && hasPermission(user, "bills.manage") && (
              <Button asChild variant="outline">
                <Link href="/stock-purchases/new">Record a purchase</Link>
              </Button>
            )}
            {hasPermission(user, "supplier_payments.manage") && (
              <Button asChild>
                <Link href={`/supplier-payments/new?supplier=${s.id}`}>Pay</Link>
              </Button>
            )}
          </>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.name} <StatusBadge status={s.status} />
          </span>
        }
        back={{ href: "/suppliers", label: "Suppliers" }}
        description={s.code}
      />
      {balance && (
        <div className="vj-stagger grid gap-3 sm:grid-cols-3">
          <Stat
            label={toDecimal(balance.balance).lessThan(0) ? "Paid in advance" : "We owe"}
            value={formatKES(toDecimal(balance.balance).abs().toFixed(2))}
            note={
              <Link href={`/suppliers/${s.id}/statement`} className="text-link hover:underline">
                Statement
              </Link>
            }
          />
          <Stat
            label="Unpaid purchases"
            value={String(balance.openBills)}
            note={<Money value={balance.owedOnBills} />}
          />
          <Stat
            label="Payment terms"
            value={s.paymentTermsDays ? `${s.paymentTermsDays} days` : "On delivery"}
          />
        </div>
      )}
      <SupplierForm
        action={updateSupplierAction}
        values={s}
        canEdit={hasPermission(user, "suppliers.manage")}
      />
    </Page>
  );
}
