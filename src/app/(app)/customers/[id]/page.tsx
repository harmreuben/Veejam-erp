import { notFound } from "next/navigation";

import Link from "next/link";

import { formatDateTime, Money, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { CUSTOMER_TYPE_LABELS } from "@/server/modules/customers/schemas";
import { getCustomer } from "@/server/modules/customers/service";
import { customerBalance } from "@/server/modules/payments/service";
import { listPriceLists } from "@/server/modules/pricing/service";

import { updateCustomerAction } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("customers.view");
  if (!user) return <NoAccess what="customers" />;
  const { id } = await params;
  const db = getDb();
  const actor = toActor(user);
  const customer = await getCustomer(db, actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const lists = hasPermission(user.role, "catalogue.view") ? await listPriceLists(db, actor) : [];
  const bal = await customerBalance(db, customer.id);

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {customer.name} <StatusBadge status={customer.status} />
          </span>
        }
        back={{ href: "/customers", label: "Customers" }}
        description={
          <>
            {customer.code} · {CUSTOMER_TYPE_LABELS[customer.type]} · Added{" "}
            {formatDateTime(customer.createdAt)}
            {customer.createdBy ? ` by ${customer.createdBy.fullName}` : ""}
            {customer.legacyNames.length > 0 && <> · Old-system name(s): {customer.legacyNames.join(", ")}</>}
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/customers/${customer.id}/statement`}>Statement</Link>
            </Button>
            {hasPermission(user.role, "payments.record") && (
              <Button asChild>
                <Link href={`/payments/new?customer=${customer.id}`}>Record payment</Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Owes on invoices</div>
          <div className="text-xl font-semibold">
            <Money value={bal.owedOnInvoices} />
          </div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Credit not yet applied</div>
          <div className="text-xl font-semibold">
            <Money value={bal.unappliedCredit} />
          </div>
        </div>
        <div className="bg-card rounded-lg border p-4">
          <div className="text-muted-foreground text-xs">Balance</div>
          <div className="text-xl font-semibold">
            <Money value={bal.balance} />
          </div>
        </div>
      </div>
      <CustomerForm
        action={updateCustomerAction}
        values={{ ...customer, priceListId: customer.priceListId }}
        types={Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        priceLists={lists
          .filter((l) => l.status === "ACTIVE" || l.id === customer.priceListId)
          .map((l) => ({ id: l.id, label: `${l.name} (${l.code})` }))}
        canCredit={hasPermission(user.role, "customers.credit")}
        canEdit={hasPermission(user.role, "customers.manage")}
        isNew={false}
      />
      <p className="text-muted-foreground text-sm">
        Balance, statement and invoice history appear here once invoicing is built (Phase 4).
      </p>
    </Page>
  );
}
