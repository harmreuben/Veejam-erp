import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, Pencil } from "lucide-react";

import { formatDate, formatDateTime, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import type { SalesDocumentKind } from "@/generated/prisma/enums";
import { formatKES, toDecimal } from "@/lib/money";
import { formatRate } from "@/lib/sales-math";
import { formatQuantity, UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { openInvoices } from "@/server/modules/payments/service";
import { getDocument } from "@/server/modules/sales/queries";
import { EDITABLE_STATUSES, KIND_LABELS } from "@/server/modules/sales/schemas";
import { MANAGE_PERMISSION } from "@/server/modules/sales/service";

import { ApplyCreditForm } from "../payments/apply-credit-form";

import { ActionButton, ConfirmButton, ShareLinkButton } from "./document-actions";
import { DeliveryStatusBadge, SalesStatusBadge } from "./status";

function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "success";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warning"
      ? "border-warning/40 bg-warning-soft"
      : tone === "success"
        ? "border-success/40 bg-success-soft"
        : "bg-muted";
  return (
    <div role="status" className={`rounded-md border p-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

const unitText = (q: number, unit: keyof typeof UNIT_LABELS) =>
  `${q} ${q === 1 ? UNIT_LABELS[unit].one : UNIT_LABELS[unit].many}`;

export async function SalesDetailPage({
  kind,
  id,
  searchParams,
}: {
  kind: SalesDocumentKind;
  id: string;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const label = KIND_LABELS[kind];
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what={label.many.toLowerCase()} />;
  const sp = await searchParams;
  const doc = await getDocument(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (doc.kind !== kind) notFound();

  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user, p);
  const canManage = can(MANAGE_PERMISSION[kind]);
  const editable = canManage && EDITABLE_STATUSES[kind].includes(doc.status);
  const title = doc.number ?? "Draft invoice";
  const base = { id: doc.id, version: doc.version };
  const showStock = doc.lines.some((l) => l.stock);
  const showDiscount = doc.lines.some((l) => !toDecimal(l.discountPercent).isZero());
  const isPostedInvoice = kind === "INVOICE" && doc.status === "POSTED";

  const creditLeft =
    kind === "CREDIT_NOTE" && can("payments.record")
      ? doc.creditsGiven.reduce((x, c) => x.minus(c.amount), toDecimal(doc.total)).toFixed(2)
      : null;
  const openForCredit =
    creditLeft && toDecimal(creditLeft).greaterThan(0) ? await openInvoices(getDb(), doc.customerId) : [];

  const actions: React.ReactNode[] = [];
  if (kind === "QUOTATION" && canManage) {
    if (doc.status === "DRAFT")
      actions.push(<ActionButton key="sent" label="Mark sent" hidden={{ ...base, intent: "SENT" }} />);
    if (["DRAFT", "SENT", "DECLINED"].includes(doc.status))
      actions.push(<ActionButton key="acc" label="Mark accepted" hidden={{ ...base, intent: "ACCEPTED" }} />);
    if (["DRAFT", "SENT", "ACCEPTED"].includes(doc.status))
      actions.push(<ActionButton key="dec" label="Mark declined" hidden={{ ...base, intent: "DECLINED" }} />);
  }
  if (kind === "QUOTATION" && ["DRAFT", "SENT", "ACCEPTED"].includes(doc.status)) {
    if (can("orders.manage"))
      actions.push(
        <ActionButton
          key="to-o"
          label="Make sales order"
          variant="default"
          hidden={{ id: doc.id, intent: "to-order" }}
        />,
      );
    if (can("invoices.manage"))
      actions.push(
        <ActionButton key="to-i" label="Make invoice" hidden={{ id: doc.id, intent: "to-invoice" }} />,
      );
  }
  if (kind === "SALES_ORDER" && doc.status === "DRAFT" && canManage) {
    actions.push(
      <ConfirmButton
        key="confirm"
        label="Confirm order…"
        variant="default"
        title={`Confirm ${doc.number}?`}
        description={
          <p>
            This reserves the stock on this order in {doc.warehouse.name}, so it can&apos;t be sold to anyone
            else. The order can&apos;t be edited after this; cancel it instead if it changes.
          </p>
        }
        confirmLabel="Confirm and reserve stock"
        hidden={{ ...base, intent: "confirm" }}
      />,
    );
  }
  if (kind === "SALES_ORDER" && doc.status === "CONFIRMED" && can("invoices.manage")) {
    actions.push(
      <ActionButton
        key="to-i"
        label="Make invoice"
        variant="default"
        hidden={{ id: doc.id, intent: "to-invoice" }}
      />,
    );
  }
  if (kind === "INVOICE" && doc.status === "DRAFT" && can("invoices.post")) {
    const canOverride = can("credit.override");
    actions.push(
      <ConfirmButton
        key="post"
        label="Post invoice…"
        variant="default"
        title="Post this invoice?"
        description={
          <>
            <p>
              It gets the next invoice number and today&apos;s date, the stock leaves {doc.warehouse.name},
              and it can&apos;t be changed afterwards. Mistakes are corrected with a credit note.
            </p>
            <p className="text-foreground font-medium">
              {doc.customer.name}: <Money value={doc.total} />
            </p>
            {doc.creditProblem && (
              <p className="text-warning font-medium">
                Credit check: {doc.creditProblem}{" "}
                {canOverride
                  ? "To post anyway, give the reason for the override below."
                  : "Ask an owner or administrator to post it."}
              </p>
            )}
          </>
        }
        fields={
          doc.creditProblem && canOverride
            ? [
                {
                  name: "creditOverrideReason",
                  label: "Reason for overriding the credit limit",
                  required: true,
                },
              ]
            : []
        }
        confirmLabel="Post invoice"
        hidden={{ ...base, intent: "post" }}
      />,
    );
  }
  if (isPostedInvoice && can("payments.record") && toDecimal(doc.balanceDue).greaterThan(0)) {
    actions.push(
      <Button key="pay" asChild>
        <Link href={`/payments/new?customer=${doc.customerId}&invoice=${doc.id}`}>Record payment</Link>
      </Button>,
    );
  }
  if (isPostedInvoice && can("credit_notes.manage")) {
    actions.push(
      <Button key="cn" variant="outline" asChild>
        <Link href={`/invoices/${doc.id}/credit`}>Credit note…</Link>
      </Button>,
    );
  }
  if (isPostedInvoice && !doc.historical && can("delivery.manage")) {
    actions.push(
      doc.deliveryNote ? (
        <Button key="dn" variant="outline" asChild>
          <Link href={`/deliveries/${doc.deliveryNote.id}`}>Delivery note {doc.deliveryNote.number}</Link>
        </Button>
      ) : (
        <ActionButton key="dn" label="Make delivery note" hidden={{ id: doc.id, intent: "deliver" }} />
      ),
    );
  }
  const cancellable =
    canManage &&
    ((kind === "QUOTATION" && ["DRAFT", "SENT", "ACCEPTED", "DECLINED"].includes(doc.status)) ||
      (kind === "SALES_ORDER" && ["DRAFT", "CONFIRMED"].includes(doc.status)) ||
      (kind === "INVOICE" && doc.status === "DRAFT"));
  if (cancellable) {
    actions.push(
      <ConfirmButton
        key="cancel"
        label="Cancel…"
        variant="ghost"
        destructive
        title={`Cancel ${title}?`}
        description={
          <p>
            {kind === "SALES_ORDER" && doc.status === "CONFIRMED" ? "Its reserved stock is released. " : ""}
            It stays on record as cancelled.
          </p>
        }
        fields={[{ name: "reason", label: "Reason", required: true }]}
        confirmLabel={`Cancel ${label.one.toLowerCase()}`}
        hidden={{ ...base, intent: "cancel" }}
      />,
    );
  }

  return (
    <Page wide>
      <PageHeader
        back={{ href: label.path, label: label.many }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {title} <SalesStatusBadge status={doc.status} />
            {doc.historical && <Badge variant="outline">Old system</Badge>}
          </span>
        }
        description={
          <>
            {label.one} for{" "}
            <Link href={`/customers/${doc.customerId}`} className="text-primary hover:underline">
              {doc.customer.name}
            </Link>{" "}
            · <Money value={doc.total} />
          </>
        }
        actions={
          <>
            {editable && (
              <Button variant="outline" asChild>
                <Link href={`${label.path}/${doc.id}/edit`}>
                  <Pencil aria-hidden /> Edit
                </Link>
              </Button>
            )}
            <Button variant="outline" asChild>
              <a href={`/documents/${doc.id}/pdf`} target="_blank" rel="noopener">
                <FileDown aria-hidden /> PDF
              </a>
            </Button>
          </>
        }
      />

      {sp.posted && kind === "CREDIT_NOTE" && (
        <Banner tone="success">
          <strong>{doc.number} issued.</strong> It has been applied to {doc.sourceDocument?.number}
          {doc.returnsToStock ? ", and the goods are back in stock" : ""}. Any amount not needed there is
          credit on the customer&apos;s account.
        </Banner>
      )}
      {sp.posted && isPostedInvoice && (
        <Banner tone="success">
          <strong>{doc.number} posted.</strong> The stock has left {doc.warehouse.name}. This invoice can no
          longer be changed.
        </Banner>
      )}
      {doc.historical && (
        <Banner>
          Brought across from the previous system with its original number and date. It took no stock out
          here.
        </Banner>
      )}
      {doc.status === "CANCELLED" && (
        <Banner>
          Cancelled {formatDateTime(doc.cancelledAt)}: {doc.cancelReason}
        </Banner>
      )}
      {kind === "INVOICE" && doc.status === "DRAFT" && (
        <Banner tone={doc.creditProblem ? "warning" : "info"}>
          This is a draft: it has no invoice number yet and no stock has moved. Prices are checked again when
          it is posted.
          {doc.creditProblem && (
            <>
              {" "}
              <strong>Credit check:</strong> {doc.creditProblem}
            </>
          )}
        </Banner>
      )}
      {kind === "SALES_ORDER" && doc.status === "CONFIRMED" && (
        <Banner>
          Stock for this order is reserved in {doc.warehouse.name} until it is invoiced or cancelled.
        </Banner>
      )}

      {actions.length > 0 && <div className="flex flex-wrap items-center gap-2">{actions}</div>}

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <Section title="Lines">
          <Table minWidth={560}>
            <THead>
              <tr>
                <TH>Product</TH>
                <TH numeric>Quantity</TH>
                <TH numeric>{doc.pricesIncludeTax ? "Price incl. VAT" : "Price excl. VAT"}</TH>
                {showDiscount && <TH numeric>Disc.</TH>}
                <TH numeric>VAT</TH>
                <TH numeric>Amount</TH>
                {showStock && <TH numeric>Available</TH>}
              </tr>
            </THead>
            <TBody>
              {doc.lines.map((l) => {
                const available = l.stock ? l.stock.available + l.reservedHere : null;
                const short = available !== null && kind !== "QUOTATION" && l.pieces > available;
                return (
                  <tr key={l.id}>
                    <TD>
                      <div className="font-medium">{l.description}</div>
                      <div className="text-muted-foreground text-xs">{l.sku}</div>
                    </TD>
                    <TD numeric className="whitespace-nowrap">
                      {unitText(l.quantity, l.unit)}
                      <div className="text-muted-foreground text-xs">
                        {l.pieces.toLocaleString("en-KE")} pcs
                      </div>
                    </TD>
                    <TD numeric>
                      <Money value={l.unitPrice} />
                    </TD>
                    {showDiscount && (
                      <TD numeric>
                        {toDecimal(l.discountPercent).isZero() ? "" : formatRate(l.discountPercent)}
                      </TD>
                    )}
                    <TD numeric>{formatRate(l.taxRate)}</TD>
                    <TD numeric>
                      <Money value={doc.pricesIncludeTax ? l.grossAmount : l.netAmount} />
                    </TD>
                    {showStock && (
                      <TD numeric className={short ? "text-warning font-medium" : undefined}>
                        {available !== null ? formatQuantity(Math.max(available, 0), l.product) : ""}
                      </TD>
                    )}
                  </tr>
                );
              })}
            </TBody>
          </Table>
          <div className="ml-auto grid w-full max-w-xs gap-1 text-sm">
            {!toDecimal(doc.discountTotal).isZero() && (
              <TotalRow label="Discounts given" value={<Money value={doc.discountTotal} />} />
            )}
            <TotalRow label="Total excl. VAT" value={<Money value={doc.subtotal} />} />
            <TotalRow label="VAT" value={<Money value={doc.taxTotal} />} />
            <TotalRow label="Total" value={<Money value={doc.total} />} strong />
            {isPostedInvoice && (
              <>
                <TotalRow label="Paid" value={<Money value={doc.amountPaid} />} />
                {!toDecimal(doc.amountCredited).isZero() && (
                  <TotalRow label="Credited" value={<Money value={doc.amountCredited} />} />
                )}
                <TotalRow label="Balance due" value={<Money value={doc.balanceDue} />} strong />
              </>
            )}
          </div>
        </Section>

        <div className="grid content-start gap-8">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Customer", value: `${doc.customer.name} (${doc.customer.code})` },
                { label: "Warehouse", value: doc.warehouse.name },
                {
                  label: "Date",
                  value:
                    kind === "INVOICE" && doc.status === "DRAFT"
                      ? "Set when posted"
                      : formatDate(doc.issueDate),
                },
                ...(kind === "QUOTATION"
                  ? [{ label: "Valid until", value: formatDate(doc.validUntil) }]
                  : []),
                ...(kind === "INVOICE"
                  ? [
                      {
                        label: "Due",
                        value: doc.dueDate ? formatDate(doc.dueDate) : `${doc.termsDays} days after posting`,
                      },
                    ]
                  : []),
                { label: "Customer ref.", value: doc.customerReference },
                { label: "Price list", value: doc.priceList?.name },
                { label: "Customer owes", value: <Money value={doc.outstanding} /> },
                {
                  label: "Credit limit",
                  value: toDecimal(doc.customer.creditLimit).isZero() ? (
                    "Cash only"
                  ) : (
                    <Money value={doc.customer.creditLimit} />
                  ),
                },
                { label: "Created", value: `${formatDateTime(doc.createdAt)} by ${doc.createdBy.fullName}` },
                ...(doc.postedAt
                  ? [
                      {
                        label: "Posted",
                        value: `${formatDateTime(doc.postedAt)} by ${doc.postedBy?.fullName}`,
                      },
                    ]
                  : []),
                ...(doc.creditOverrideReason
                  ? [
                      {
                        label: "Credit override",
                        value: `${doc.creditOverrideBy?.fullName}: ${doc.creditOverrideReason}`,
                      },
                    ]
                  : []),
                ...(doc.notes ? [{ label: "Notes", value: doc.notes }] : []),
              ]}
            />
          </Section>

          {(doc.settlements.length > 0 || doc.creditsGiven.length > 0) && (
            <Section title={kind === "CREDIT_NOTE" ? "Applied to" : "Payments and credits"}>
              <ul className="grid gap-1 text-sm">
                {doc.settlements.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    {a.payment ? (
                      <Link href={`/payments/${a.payment.id}`} className="text-primary hover:underline">
                        {a.payment.number}
                      </Link>
                    ) : (
                      <Link
                        href={`/credit-notes/${a.creditNote!.id}`}
                        className="text-primary hover:underline"
                      >
                        {a.creditNote!.number}
                      </Link>
                    )}
                    <Money value={a.amount} />
                  </li>
                ))}
                {doc.creditsGiven.map((a) => (
                  <li key={a.id} className="flex justify-between gap-3">
                    <Link href={`/invoices/${a.invoice.id}`} className="text-primary hover:underline">
                      {a.invoice.number}
                    </Link>
                    <Money value={a.amount} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(doc.sourceDocument || doc.derivedDocuments.length > 0 || doc.deliveryNote) && (
            <Section title="Related">
              <ul className="grid gap-1 text-sm">
                {doc.sourceDocument && (
                  <li>
                    From{" "}
                    <Link
                      className="text-primary hover:underline"
                      href={`${KIND_LABELS[doc.sourceDocument.kind].path}/${doc.sourceDocument.id}`}
                    >
                      {doc.sourceDocument.number}
                    </Link>
                  </li>
                )}
                {doc.derivedDocuments.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Link
                      className="text-primary hover:underline"
                      href={`${KIND_LABELS[d.kind].path}/${d.id}`}
                    >
                      {d.number ?? `Draft ${KIND_LABELS[d.kind].one.toLowerCase()}`}
                    </Link>
                    <SalesStatusBadge status={d.status} />
                  </li>
                ))}
                {doc.deliveryNote && (
                  <li className="flex items-center gap-2">
                    <Link
                      className="text-primary hover:underline"
                      href={`/deliveries/${doc.deliveryNote.id}`}
                    >
                      {doc.deliveryNote.number}
                    </Link>
                    <DeliveryStatusBadge status={doc.deliveryNote.status} />
                  </li>
                )}
              </ul>
            </Section>
          )}

          {creditLeft && toDecimal(creditLeft).greaterThan(0) && (
            <Section
              title="Credit not yet applied"
              description={`${formatKES(creditLeft)} of this credit note can go towards other invoices.`}
            >
              <ApplyCreditForm
                id={doc.id}
                source="creditNote"
                available={creditLeft}
                invoices={openForCredit.map((i) => ({
                  id: i.id,
                  number: i.number,
                  due: formatDate(i.dueDate),
                  outstanding: i.outstanding,
                }))}
              />
            </Section>
          )}

          {can("documents.share") &&
            doc.status !== "CANCELLED" &&
            (kind !== "INVOICE" || isPostedInvoice) && (
              <Section
                title="Share with the customer"
                description="A link that opens this document's PDF without signing in."
              >
                <ShareLinkButton documentId={doc.id} />
                {doc.shareLinks.length > 0 && (
                  <ul className="grid gap-2 text-sm">
                    {doc.shareLinks.map((l) => {
                      const live = !l.revokedAt && l.expiresAt > new Date();
                      return (
                        <li
                          key={l.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
                        >
                          <span>
                            {formatDate(l.createdAt)} by {l.createdBy.fullName} ·{" "}
                            {l.revokedAt
                              ? "revoked"
                              : live
                                ? `expires ${formatDate(l.expiresAt)}`
                                : "expired"}{" "}
                            · opened {l.accessCount}×
                          </span>
                          {live && (
                            <ActionButton
                              label="Revoke"
                              variant="ghost"
                              hidden={{ id: doc.id, linkId: l.id, intent: "revoke" }}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Section>
            )}
        </div>
      </div>
    </Page>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t pt-1 text-base font-semibold" : ""}`}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
