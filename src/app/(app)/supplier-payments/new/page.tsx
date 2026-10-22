import { randomUUID } from "node:crypto";

import { param } from "@/components/filters";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { formatShortDay, todayInNairobi } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { openBills, supplierBalance } from "@/server/modules/purchasing/payables";
import { isUuid } from "@/server/shared/validation";

import { SupplierPaymentForm } from "../../_purchasing/supplier-payment-form";

export const metadata = { title: "Pay a supplier" };

export default async function NewSupplierPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("supplier_payments.manage");
  if (!user) return <NoAccess what="paying suppliers" />;
  const sp = await searchParams;
  const db = getDb();
  const s = param(sp.supplier);
  const supplierId = s && isUuid(s) ? s : null;
  const suppliers = await db.supplier.findMany({
    where: { OR: [{ status: "ACTIVE" }, ...(supplierId ? [{ id: supplierId }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  const [bills, balance] = supplierId
    ? await Promise.all([openBills(db, toActor(user), supplierId), supplierBalance(db, supplierId)])
    : [[], null];
  return (
    <Page>
      <PageHeader title="Pay a supplier" back={{ href: "/supplier-payments", label: "Supplier payments" }} />
      <SupplierPaymentForm
        key={supplierId ?? "none"}
        suppliers={suppliers.map((x) => ({ id: x.id, label: `${x.name} (${x.code})` }))}
        supplierId={supplierId}
        bills={bills.map((b) => ({
          id: b.id,
          number: `${b.number} · ${b.supplierInvoiceNumber}`,
          date: formatShortDay(b.billDate),
          due: formatShortDay(b.dueDate),
          total: b.total,
          outstanding: b.outstanding,
        }))}
        balance={balance}
        idempotencyKey={randomUUID()}
        today={todayInNairobi()}
        preselect={param(sp.bill) ?? null}
      />
    </Page>
  );
}
