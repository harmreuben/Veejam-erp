import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown, PackageCheck, Pencil } from "lucide-react";

import { formatDateTime, Money, Qty } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay, formatShortDay } from "@/lib/dates";
import { formatRate } from "@/lib/sales-math";
import { UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getPurchaseOrder } from "@/server/modules/purchasing/orders";

import { ActionButton, ConfirmButton } from "../../_sales/document-actions";
import { purchaseOrderAction } from "../../_purchasing/actions";
import { PoStatusBadge } from "../../_purchasing/ui";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="purchasing" />;
  const sp = await searchParams;
  const po = await getPurchaseOrder(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const manage = hasPermission(user, "purchasing.manage");
  const canReceive =
    hasPermission(user, "goods.receive") && (po.status === "ORDERED" || po.status === "PARTLY_RECEIVED");
  const hidden = { id: po.id, version: po.version };
  return (
    <Page wide>
      <PageHeader
        back={{ href: "/purchase-orders", label: "Purchase orders" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {po.number}
            <PoStatusBadge status={po.status} />
          </span>
        }
        description={
          <>
            To {po.supplier.name} · {formatLongDay(po.orderDate)}
            {po.expectedDate && <> · expected {formatLongDay(po.expectedDate)}</>}
          </>
        }
        actions={
          <>
            {canReceive && (
              <Button asChild>
                <Link href={`/goods-received/new?po=${po.id}`}>
                  <PackageCheck aria-hidden /> Receive goods
                </Link>
              </Button>
            )}
            {manage && po.status === "DRAFT" && (
              <>
                <ActionButton
                  action={purchaseOrderAction}
                  variant="default"
                  label="Mark as ordered"
                  hidden={{ ...hidden, intent: "order" }}
                />
                <Button variant="outline" asChild>
                  <Link href={`/purchase-orders/${po.id}/edit`}>
                    <Pencil aria-hidden /> Edit
                  </Link>
                </Button>
              </>
            )}
            {po.showCosts && (
              <Button variant="outline" asChild>
                <a href={`/purchase-orders/${po.id}/pdf`} target="_blank" rel="noopener">
                  <FileDown aria-hidden /> PDF
                </a>
              </Button>
            )}
            {manage && (po.status === "DRAFT" || po.status === "ORDERED") && (
              <ConfirmButton
                action={purchaseOrderAction}
                variant="ghost"
                destructive
                label="Cancel…"
                title={`Cancel ${po.number}?`}
                description={
                  <p>
                    Tell the supplier too if you have already sent it. The order stays on record, marked
                    cancelled.
                  </p>
                }
                fields={[{ name: "reason", label: "Reason", required: true }]}
                confirmLabel="Cancel order"
                hidden={{ ...hidden, intent: "cancel" }}
              />
            )}
            {manage && po.status === "PARTLY_RECEIVED" && (
              <ConfirmButton
                action={purchaseOrderAction}
                variant="ghost"
                label="Close…"
                title={`Close ${po.number}?`}
                description={
                  <p>
                    Stop expecting the rest of this order, e.g. the supplier ran out. What was received stays
                    received.
                  </p>
                }
                fields={[{ name: "reason", label: "Reason", required: true }]}
                confirmLabel="Close order"
                hidden={{ ...hidden, intent: "close" }}
              />
            )}
          </>
        }
      />
      {sp.saved && (
        <div role="status" className="border-success/40 bg-success-soft rounded-md border p-3 text-sm">
          <strong>{po.number} saved.</strong>{" "}
          {po.status === "DRAFT" &&
            "When it's sent to the supplier, click Mark as ordered so goods can be received against it."}
        </div>
      )}
      {po.status === "CANCELLED" && (
        <div className="bg-muted rounded-md border p-3 text-sm">
          Cancelled {formatDateTime(po.cancelledAt)}: {po.cancelReason}
        </div>
      )}
      {po.status === "CLOSED" && (
        <div className="bg-muted rounded-md border p-3 text-sm">
          Closed {formatDateTime(po.closedAt)}: {po.cancelReason}
        </div>
      )}
      <Table minWidth={760}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>Ordered</TH>
            <TH numeric>Received</TH>
            {po.showCosts && (
              <>
                <TH numeric>Cost per unit</TH>
                <TH numeric>VAT</TH>
                <TH numeric>Amount excl. VAT</TH>
              </>
            )}
          </tr>
        </THead>
        <TBody>
          {po.lines.map((l) => (
            <tr key={l.id}>
              <TD>
                {l.description}
                <div className="text-muted-foreground font-mono text-xs">{l.sku}</div>
              </TD>
              <TD numeric>
                {l.quantity} {l.quantity === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many}
              </TD>
              <TD numeric className={l.receivedPieces >= l.pieces ? "text-success" : undefined}>
                {l.receivedPieces ? <Qty pieces={l.receivedPieces} sizes={l.sizes} /> : "—"}
              </TD>
              {po.showCosts && (
                <>
                  <TD numeric>
                    <Money value={l.unitCost} />
                  </TD>
                  <TD numeric>{formatRate(l.taxRate)}</TD>
                  <TD numeric>
                    <Money value={l.netAmount} />
                  </TD>
                </>
              )}
            </tr>
          ))}
        </TBody>
      </Table>
      {po.showCosts && (
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">Excluding VAT</dt>
          <dd className="text-right">
            <Money value={po.subtotal} />
          </dd>
          <dt className="text-muted-foreground">VAT</dt>
          <dd className="text-right">
            <Money value={po.taxTotal} />
          </dd>
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">
            <Money value={po.total} />
          </dd>
        </dl>
      )}
      <Section title="Goods received">
        <Table minWidth={480}>
          <THead>
            <tr>
              <TH>Note</TH>
              <TH>Date</TH>
              {po.showCosts && <TH numeric>At cost</TH>}
            </tr>
          </THead>
          <TBody>
            {po.receipts.length === 0 && <EmptyRow colSpan={3}>Nothing received yet.</EmptyRow>}
            {po.receipts.map((r) => (
              <tr key={r.id}>
                <TD>
                  <Link href={`/goods-received/${r.id}`} className="text-primary hover:underline">
                    {r.number}
                  </Link>
                </TD>
                <TD>{formatShortDay(r.receivedOn)}</TD>
                {po.showCosts && (
                  <TD numeric>
                    <Money value={r.totalCost} />
                  </TD>
                )}
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Supplier",
              value: (
                <Link href={`/suppliers/${po.supplier.id}`} className="text-primary hover:underline">
                  {po.supplier.name} ({po.supplier.code})
                </Link>
              ),
            },
            { label: "Deliver to", value: po.warehouse.name },
            { label: "Created", value: `${formatDateTime(po.createdAt)} by ${po.createdBy}` },
            ...(po.orderedAt ? [{ label: "Ordered", value: formatDateTime(po.orderedAt) }] : []),
            ...(po.notes ? [{ label: "Notes", value: po.notes }] : []),
          ]}
        />
      </Section>
    </Page>
  );
}
