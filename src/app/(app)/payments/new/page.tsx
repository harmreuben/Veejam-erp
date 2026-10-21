import { randomUUID } from "node:crypto";

import { formatDate } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { param } from "@/components/filters";
import { todayInNairobi } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { customerBalance, openInvoices } from "@/server/modules/payments/service";
import { isUuid } from "@/server/shared/validation";

import { PaymentForm } from "../payment-form";

export const metadata = { title: "Record payment" };

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("payments.record");
  if (!user) return <NoAccess what="recording payments" />;
  const sp = await searchParams;
  const db = getDb();
  const customerParam = param(sp.customer);
  const customerId = customerParam && isUuid(customerParam) ? customerParam : null;
  const customers = await db.customer.findMany({
    where: { OR: [{ status: "ACTIVE" }, ...(customerId ? [{ id: customerId }] : [])] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  const [invoices, balance] = customerId
    ? await Promise.all([openInvoices(db, customerId), customerBalance(db, customerId)])
    : [[], null];
  return (
    <Page>
      <PageHeader title="Record payment" back={{ href: "/payments", label: "Payments" }} />
      <PaymentForm
        customers={customers.map((c) => ({ id: c.id, label: `${c.name} (${c.code})` }))}
        customerId={customerId}
        invoices={invoices.map((i) => ({
          id: i.id,
          number: i.number,
          date: formatDate(i.issueDate),
          due: formatDate(i.dueDate),
          total: i.total,
          outstanding: i.outstanding,
        }))}
        balance={balance}
        idempotencyKey={randomUUID()}
        today={todayInNairobi()}
        preselect={param(sp.invoice) ?? null}
      />
    </Page>
  );
}
