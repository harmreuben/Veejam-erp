import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { getSupplierPayment } from "@/server/modules/purchasing/payables";

import { ConfirmButton } from "../../_sales/document-actions";
import { supplierPaymentAction } from "../../_purchasing/actions";

export const metadata = { title: "Supplier payment" };

export default async function SupplierPaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier payments" />;
  const sp = await searchParams;
  const p = await getSupplierPayment(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const reversed = p.status === "REVERSED";
  const active = p.allocations.filter((a) => !a.reversedAt);
  return (
    <Page>
      <PageHeader
        back={{ href: "/supplier-payments", label: "Supplier payments" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.number}
            {reversed ? <Badge variant="secondary">Reversed</Badge> : <Badge variant="success">Paid</Badge>}
          </span>
        }
        description={
          <>
            <Money value={p.amount.toFixed(2)} /> to{" "}
            <Link href={`/suppliers/${p.supplier.id}`} className="text-primary hover:underline">
              {p.supplier.name}
            </Link>{" "}
            by {METHOD_LABELS[p.method]} on {formatLongDay(p.paidOn)}
          </>
        }
        actions={
          !reversed &&
          hasPermission(user, "supplier_payments.manage") && (
            <ConfirmButton
              action={supplierPaymentAction}
              variant="ghost"
              destructive
              label="Reverse…"
              title={`Reverse ${p.number}?`}
              description={
                <p>
                  For a payment recorded by mistake or a cheque that didn&apos;t go through. The bills it paid
                  become unpaid again and a reversing entry is posted today.
                </p>
              }
              fields={[{ name: "reason", label: "Reason", required: true }]}
              confirmLabel="Reverse payment"
              hidden={{ id: p.id, version: p.version }}
            />
          )
        }
      />
      {sp.recorded && (
        <div role="status" className="border-success/40 bg-success-soft rounded-md border p-3 text-sm">
          <strong>{p.number} recorded.</strong> Applied <Money value={p.applied} />.
          {toDecimal(p.unapplied).greaterThan(0) && (
            <>
              {" "}
              <Money value={p.unapplied} /> is paid in advance and goes to {p.supplier.name}&apos;s next bill.
            </>
          )}
        </div>
      )}
      {reversed && (
        <div className="bg-muted rounded-md border p-3 text-sm">
          Reversed {formatDateTime(p.reversedAt)} by {p.reversedBy?.fullName}: {p.reverseReason}
        </div>
      )}
      <Section title="Bills paid">
        <Table minWidth={480}>
          <THead>
            <tr>
              <TH>Bill</TH>
              <TH numeric>Bill total</TH>
              <TH numeric>Paid by this</TH>
            </tr>
          </THead>
          <TBody>
            {active.length === 0 && <EmptyRow colSpan={3}>Not applied to any bill.</EmptyRow>}
            {active.map((a) => (
              <tr key={a.id}>
                <TD>
                  <Link href={`/supplier-bills/${a.bill.id}`} className="text-primary hover:underline">
                    {a.bill.number}
                  </Link>{" "}
                  <span className="text-muted-foreground font-mono text-xs">
                    {a.bill.supplierInvoiceNumber}
                  </span>
                </TD>
                <TD numeric>
                  <Money value={a.bill.total.toFixed(2)} />
                </TD>
                <TD numeric>
                  <Money value={a.amount.toFixed(2)} />
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="Details">
        <DetailList
          items={[
            { label: "Method", value: METHOD_LABELS[p.method] },
            {
              label: "Reference",
              value: p.reference ? <span className="font-mono">{p.reference}</span> : null,
            },
            { label: "Paid in advance", value: <Money value={p.unapplied} /> },
            { label: "Recorded", value: `${formatDateTime(p.createdAt)} by ${p.paidBy.fullName}` },
            ...(p.notes ? [{ label: "Notes", value: p.notes }] : []),
          ]}
        />
      </Section>
    </Page>
  );
}
