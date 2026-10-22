import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay } from "@/lib/dates";
import { UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getGoodsReceipt } from "@/server/modules/purchasing/receipts";

export const metadata = { title: "Goods received" };

export default async function GoodsReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="purchasing" />;
  const sp = await searchParams;
  const g = await getGoodsReceipt(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <Page>
      <PageHeader
        back={{ href: "/goods-received", label: "Goods received" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {g.number}
            {g.bill ? (
              <Badge variant="success">Billed</Badge>
            ) : (
              <Badge variant="warning">Not billed yet</Badge>
            )}
          </span>
        }
        description={
          <>
            From {g.supplier.name} into {g.warehouse} · {formatLongDay(g.receivedOn)}
          </>
        }
        actions={
          !g.bill &&
          hasPermission(user.role, "bills.manage") && (
            <Button asChild>
              <Link href={`/supplier-bills/new?supplier=${g.supplier.id}&grn=${g.id}`}>
                Enter the supplier&apos;s bill
              </Link>
            </Button>
          )
        }
      />
      {sp.uncosted && (
        <div role="status" className="border-warning/40 bg-warning-soft rounded-md border p-3 text-sm">
          <strong>Some of these products were already in stock with no cost.</strong> Their average cost now
          mixes this delivery with stock valued at nothing, so it&apos;s too low.{" "}
          {hasPermission(user.role, "inventory.revalue") ? (
            <>
              Set the right cost per piece on{" "}
              <Link href="/reports/stock" className="underline">
                Stock value
              </Link>{" "}
              (tick &ldquo;opening stock&rdquo;).
            </>
          ) : (
            "Ask an owner or administrator to set the opening cost on Stock value."
          )}
        </div>
      )}
      {sp.posted && (
        <div role="status" className="border-success/40 bg-success-soft rounded-md border p-3 text-sm">
          <strong>{g.number} posted.</strong> The stock is in
          {g.totalCost ? (
            <>
              {" "}
              at <Money value={g.totalCost} />
            </>
          ) : null}
          .
        </div>
      )}
      <Table minWidth={560}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>Received</TH>
            {g.showCosts && (
              <>
                <TH numeric>Cost per unit</TH>
                <TH numeric>At cost</TH>
              </>
            )}
          </tr>
        </THead>
        <TBody>
          {g.lines.map((l) => (
            <tr key={l.id}>
              <TD>
                {l.name}
                <div className="text-muted-foreground font-mono text-xs">{l.sku}</div>
              </TD>
              <TD numeric>
                {l.quantity} {l.quantity === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many}
                <div className="text-muted-foreground text-xs">{l.quantityText}</div>
              </TD>
              {g.showCosts && (
                <>
                  <TD numeric>
                    <Money value={l.unitCost} />
                  </TD>
                  <TD numeric>
                    <Money value={l.lineCost} />
                  </TD>
                </>
              )}
            </tr>
          ))}
        </TBody>
      </Table>
      <Section title="Details">
        <DetailList
          items={[
            { label: "Supplier", value: g.supplier.name },
            {
              label: "Purchase order",
              value: g.purchaseOrder ? (
                <Link
                  href={`/purchase-orders/${g.purchaseOrder.id}`}
                  className="text-primary hover:underline"
                >
                  {g.purchaseOrder.number}
                </Link>
              ) : (
                "None (received without an order)"
              ),
            },
            { label: "Supplier's reference", value: g.supplierReference },
            ...(g.showCosts
              ? [
                  { label: "Value at cost", value: <Money value={g.totalCost} /> },
                  { label: "Expected VAT", value: <Money value={g.expectedTax} /> },
                ]
              : []),
            {
              label: "Bill",
              value: g.bill ? (
                hasPermission(user.role, "payables.view") ? (
                  <Link href={`/supplier-bills/${g.bill.id}`} className="text-primary hover:underline">
                    {g.bill.number} (invoice {g.bill.supplierInvoiceNumber})
                  </Link>
                ) : (
                  g.bill.number
                )
              ) : (
                "Not billed yet"
              ),
            },
            { label: "Posted", value: `${formatDateTime(g.postedAt)} by ${g.postedBy}` },
            ...(g.notes ? [{ label: "Notes", value: g.notes }] : []),
          ]}
        />
      </Section>
    </Page>
  );
}
