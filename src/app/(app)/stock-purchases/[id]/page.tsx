import Link from "next/link";
import { notFound } from "next/navigation";

import { Banner } from "@/components/banner";
import { formatDate, formatDateTime, Money, Qty } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDbDate } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { getStockPurchase } from "@/server/modules/purchasing/stock-purchase";

export const metadata = { title: "Stock purchase" };

export default async function StockPurchasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="stock purchases" />;
  const sp = await searchParams;
  const p = await getStockPurchase(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const owed = toDecimal(p.owed).greaterThan(0);
  return (
    <Page>
      <PageHeader
        back={{ href: "/stock-purchases", label: "Stock purchases" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{p.number}</span>
            {owed ? <Badge variant="warning">Owed</Badge> : <Badge variant="success">Paid</Badge>}
          </span>
        }
        description={
          <>
            From {p.supplier.name} · <Money value={p.total} />
          </>
        }
        actions={
          owed &&
          hasPermission(user, "supplier_payments.manage") && (
            <Button asChild>
              <Link
                href={`/supplier-payments/new?supplier=${p.supplier.id}${p.bill ? `&bill=${p.bill.id}` : ""}`}
              >
                Pay the supplier
              </Link>
            </Button>
          )
        }
      />
      {sp.recorded && (
        <Banner tone="success">
          <strong>{p.number} recorded.</strong> The stock is in {p.warehouse} at cost
          {owed ? ", and the amount is owed to the supplier." : ", and the payment is recorded."}
        </Banner>
      )}
      <DetailList
        items={[
          { label: "Supplier", value: p.supplier.name },
          { label: "Supplier's invoice", value: <span className="font-mono">{p.supplierReference}</span> },
          { label: "Date", value: formatDate(toDbDate(p.date)) },
          { label: "Into", value: p.warehouse },
          { label: "Recorded", value: `${formatDateTime(p.postedAt)} by ${p.postedBy}` },
          ...(p.notes ? [{ label: "Notes", value: p.notes }] : []),
        ]}
      />
      <Section title="What was bought">
        <Table minWidth={600}>
          <THead>
            <tr>
              <TH>Product</TH>
              <TH numeric>Quantity</TH>
              <TH numeric>Cost per unit</TH>
              <TH numeric>Cost</TH>
            </tr>
          </THead>
          <TBody>
            {p.lines.map((l) => (
              <tr key={l.id}>
                <TD className="min-w-48">
                  <Link href={`/products/${l.product.id}`} className="hover:underline">
                    {l.product.name}
                  </Link>
                  <div className="text-muted-foreground font-mono text-xs">{l.product.sku}</div>
                </TD>
                <TD numeric>
                  {l.quantity} {l.quantity === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many}
                  <div className="text-muted-foreground text-xs">
                    <Qty pieces={l.pieces} sizes={l.product} />
                  </div>
                </TD>
                <TD numeric>
                  <Money value={l.unitCost} />
                </TD>
                <TD numeric>
                  <Money value={l.lineCost} />
                </TD>
              </tr>
            ))}
            <tr className="bg-muted/40">
              <TD colSpan={3}>Stock cost</TD>
              <TD numeric>
                <Money value={p.cost} />
              </TD>
            </tr>
            {p.tax !== "0.00" && (
              <tr className="bg-muted/40">
                <TD colSpan={3}>VAT (recoverable)</TD>
                <TD numeric>
                  <Money value={p.tax} />
                </TD>
              </tr>
            )}
            <tr className="bg-muted/40 font-semibold">
              <TD colSpan={3}>Total</TD>
              <TD numeric>
                <Money value={p.total} />
              </TD>
            </tr>
          </TBody>
        </Table>
      </Section>
      <Section title="Payments">
        {p.payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Not paid yet: <Money value={p.owed} /> is owed to {p.supplier.name}.
          </p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {p.payments.map((pay) => (
              <li key={pay.id}>
                <Link href={`/supplier-payments/${pay.id}`} className="text-link font-mono hover:underline">
                  {pay.number}
                </Link>{" "}
                · {formatDate(toDbDate(pay.date))} · {METHOD_LABELS[pay.method]}
                {pay.reference && <span className="font-mono"> {pay.reference}</span>} ·{" "}
                <Money value={pay.amount} />
              </li>
            ))}
            {owed && (
              <li className="text-muted-foreground">
                Still owed: <Money value={p.owed} />
              </li>
            )}
          </ul>
        )}
      </Section>
    </Page>
  );
}
