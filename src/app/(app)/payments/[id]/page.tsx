import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";

import { formatDate, formatDateTime, Money } from "@/components/format";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDecimal } from "@/lib/money";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { getPayment } from "@/server/modules/payments/service";

import { ConfirmButton } from "../../_sales/document-actions";
import { paymentAction } from "../actions";
import { ApplyCreditForm } from "../apply-credit-form";

export const metadata = { title: "Payment" };

export default async function PaymentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="payments" />;
  const sp = await searchParams;
  const p = await getPayment(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const reversed = p.status === "REVERSED";
  const canApply =
    !reversed && hasPermission(user, "payments.record") && toDecimal(p.unapplied).greaterThan(0);
  return (
    <Page>
      <PageHeader
        back={{ href: "/payments", label: "Payments" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.number}
            {reversed ? (
              <Badge variant="secondary">Reversed</Badge>
            ) : (
              <Badge variant="success">Received</Badge>
            )}
          </span>
        }
        description={
          <>
            <Money value={p.amount} /> from{" "}
            <Link href={`/customers/${p.customerId}`} className="text-primary hover:underline">
              {p.customer.name}
            </Link>{" "}
            by {METHOD_LABELS[p.method]}
          </>
        }
        actions={
          <>
            {!reversed && hasPermission(user, "payments.reverse") && (
              <ConfirmButton
                action={paymentAction}
                variant="ghost"
                destructive
                label="Reverse…"
                title={`Reverse ${p.number}?`}
                description={
                  <p>
                    For a payment recorded by mistake or a bounced cheque. The invoices it paid become unpaid
                    again, and a reversing entry is posted today. The receipt stays on record, marked
                    reversed.
                  </p>
                }
                fields={[{ name: "reason", label: "Reason", required: true }]}
                confirmLabel="Reverse payment"
                hidden={{ id: p.id, version: p.version, intent: "reverse" }}
              />
            )}
            <Button variant="outline" asChild>
              <a href={`/payments/${p.id}/pdf`} target="_blank" rel="noopener">
                <FileDown aria-hidden /> Receipt
              </a>
            </Button>
          </>
        }
      />
      {sp.recorded && (
        <div role="status" className="border-success/40 bg-success-soft rounded-md border p-3 text-sm">
          <strong>{p.number} recorded.</strong>{" "}
          {toDecimal(p.applied).greaterThan(0) && (
            <>
              Applied <Money value={p.applied} />.{" "}
            </>
          )}
          {toDecimal(p.unapplied).greaterThan(0) && (
            <>
              <Money value={p.unapplied} /> is kept as credit on {p.customer.name}&apos;s account.
            </>
          )}
        </div>
      )}
      {reversed && (
        <div role="status" className="bg-muted rounded-md border p-3 text-sm">
          Reversed {formatDateTime(p.reversedAt)} by {p.reversedBy?.fullName}: {p.reverseReason}
        </div>
      )}
      <Section title="Details">
        <DetailList
          items={[
            { label: "Received", value: formatDate(p.receivedOn) },
            { label: "Method", value: METHOD_LABELS[p.method] },
            {
              label: "Reference",
              value: p.reference ? <span className="font-mono">{p.reference}</span> : null,
            },
            { label: "Amount", value: <Money value={p.amount} /> },
            { label: "Applied to invoices", value: <Money value={p.applied} /> },
            { label: "Credit not yet applied", value: <Money value={p.unapplied} /> },
            { label: "Recorded", value: `${formatDateTime(p.createdAt)} by ${p.receivedBy.fullName}` },
            ...(p.notes ? [{ label: "Notes", value: p.notes }] : []),
            ...(p.journal.length && hasPermission(user, "accounting.view")
              ? [
                  {
                    label: "Journal",
                    value: (
                      <span className="flex flex-wrap gap-2">
                        {p.journal.map((j) => (
                          <Link
                            key={j.id}
                            href={`/accounting/journal/${j.id}`}
                            className="text-primary hover:underline"
                          >
                            {j.number}
                          </Link>
                        ))}
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Section>
      <Section title="Applied to">
        <Table minWidth={480}>
          <THead>
            <tr>
              <TH>Invoice</TH>
              <TH>When</TH>
              <TH numeric>Amount</TH>
            </tr>
          </THead>
          <TBody>
            {p.allocations.length === 0 && (
              <tr>
                <TD colSpan={3} className="text-muted-foreground">
                  Not applied to any invoice.
                </TD>
              </tr>
            )}
            {p.allocations.map((a) => (
              <tr key={a.id} className={a.reversedAt ? "text-muted-foreground line-through" : undefined}>
                <TD>
                  <Link href={`/invoices/${a.invoice.id}`} className="hover:underline">
                    {a.invoice.number}
                  </Link>
                </TD>
                <TD>{formatDateTime(a.createdAt)}</TD>
                <TD numeric>
                  <Money value={a.amount} />
                </TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
      {canApply && (
        <Section
          title="Apply the credit"
          description="Use what's left of this payment on the customer's unpaid invoices."
        >
          <ApplyCreditForm
            id={p.id}
            source="payment"
            available={p.unapplied}
            invoices={p.openInvoices.map((i) => ({
              id: i.id,
              number: i.number,
              due: formatDate(i.dueDate),
              outstanding: i.outstanding,
            }))}
          />
        </Section>
      )}
    </Page>
  );
}
