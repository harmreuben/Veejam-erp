import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatLongDay, formatShortDay, fromDbDate, todayInNairobi } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import { getBill } from "@/server/modules/purchasing/payables";

import { ConfirmButton } from "../../_sales/document-actions";
import { billAction } from "../../_purchasing/actions";
import { BillStateBadge, type BillState } from "../../_purchasing/ui";

export const metadata = { title: "Supplier bill" };

export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("payables.view");
  if (!user) return <NoAccess what="supplier bills" />;
  const sp = await searchParams;
  const b = await getBill(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const outstanding = toDecimal(b.outstanding);
  const state: BillState =
    b.status === "CANCELLED"
      ? "CANCELLED"
      : outstanding.isZero()
        ? "PAID"
        : b.dueDate < todayInNairobi()
          ? "OVERDUE"
          : b.amountPaid.greaterThan(0)
            ? "PART_PAID"
            : "UNPAID";
  const active = b.allocations.filter((a) => !a.reversedAt);
  return (
    <Page>
      <PageHeader
        back={{ href: "/supplier-bills", label: "Supplier bills" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {b.number}
            <BillStateBadge state={state} />
          </span>
        }
        description={
          <>
            {b.supplier.name} invoice <span className="font-mono">{b.supplierInvoiceNumber}</span> ·{" "}
            {formatLongDay(b.billDate)} · due {formatLongDay(b.dueDate)}
          </>
        }
        actions={
          <>
            {b.status === "POSTED" &&
              outstanding.greaterThan(0) &&
              hasPermission(user.role, "supplier_payments.manage") && (
                <Button asChild>
                  <Link href={`/supplier-payments/new?supplier=${b.supplier.id}&bill=${b.id}`}>
                    Pay this bill
                  </Link>
                </Button>
              )}
            {b.status === "POSTED" && hasPermission(user.role, "bills.manage") && (
              <ConfirmButton
                action={billAction}
                variant="ghost"
                destructive
                label="Cancel…"
                title={`Cancel ${b.number}?`}
                description={
                  <p>
                    For a bill entered by mistake. A reversing entry is posted today, its deliveries can be
                    billed again, and any money paid against it stays with {b.supplier.name} as credit for the
                    next bill.
                  </p>
                }
                fields={[{ name: "reason", label: "Reason", required: true }]}
                confirmLabel="Cancel bill"
                hidden={{ id: b.id, version: b.version }}
              />
            )}
          </>
        }
      />
      {sp.posted && (
        <div role="status" className="border-success/40 bg-success-soft rounded-md border p-3 text-sm">
          <strong>{b.number} entered.</strong>{" "}
          {b.amountPaid.greaterThan(0) && (
            <>
              <Money value={b.amountPaid.toFixed(2)} /> was already paid from earlier payments.
            </>
          )}
        </div>
      )}
      {b.status === "CANCELLED" && (
        <div className="bg-muted rounded-md border p-3 text-sm">
          Cancelled {formatDateTime(b.cancelledAt)} by {b.cancelledBy?.fullName}: {b.cancelReason}
        </div>
      )}
      <Table minWidth={560}>
        <THead>
          <tr>
            <TH>For</TH>
            <TH numeric>Excl. VAT</TH>
            <TH numeric>VAT</TH>
            <TH numeric>Total</TH>
          </tr>
        </THead>
        <TBody>
          {b.lines.map((l) => (
            <tr key={l.id}>
              <TD>
                {l.goodsReceipt ? (
                  <Link
                    href={`/goods-received/${l.goodsReceipt.id}`}
                    className="text-primary hover:underline"
                  >
                    {l.description}
                  </Link>
                ) : (
                  l.description
                )}
                <div className="text-muted-foreground text-xs">
                  {l.goodsReceipt ? (
                    <>
                      At cost on receipt: <Money value={l.goodsReceipt.totalCost.toFixed(2)} />
                    </>
                  ) : (
                    `${l.account?.code} ${l.account?.name}`
                  )}
                </div>
              </TD>
              <TD numeric>
                <Money value={l.netAmount.toFixed(2)} />
              </TD>
              <TD numeric>
                <Money value={l.taxAmount.toFixed(2)} />
              </TD>
              <TD numeric>
                <Money value={l.grossAmount.toFixed(2)} />
              </TD>
            </tr>
          ))}
          <tr className="font-semibold">
            <TD>Total</TD>
            <TD numeric>
              <Money value={b.subtotal.toFixed(2)} />
            </TD>
            <TD numeric>
              <Money value={b.taxTotal.toFixed(2)} />
            </TD>
            <TD numeric>
              <Money value={b.total.toFixed(2)} />
            </TD>
          </tr>
        </TBody>
      </Table>
      <Section
        title="Payments"
        description={
          b.status === "POSTED" ? (
            <>
              Still to pay: <Money value={b.outstanding} />
            </>
          ) : undefined
        }
      >
        <Table minWidth={480}>
          <THead>
            <tr>
              <TH>Payment</TH>
              <TH>Date</TH>
              <TH>Method</TH>
              <TH numeric>Applied</TH>
            </tr>
          </THead>
          <TBody>
            {active.length === 0 && <EmptyRow colSpan={4}>Nothing paid yet.</EmptyRow>}
            {active.map((a) => (
              <tr key={a.id}>
                <TD>
                  <Link href={`/supplier-payments/${a.payment.id}`} className="text-primary hover:underline">
                    {a.payment.number}
                  </Link>
                </TD>
                <TD>{formatShortDay(fromDbDate(a.payment.paidOn))}</TD>
                <TD>{METHOD_LABELS[a.payment.method]}</TD>
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
            {
              label: "Supplier",
              value: (
                <Link href={`/suppliers/${b.supplier.id}`} className="text-primary hover:underline">
                  {b.supplier.name} ({b.supplier.code})
                </Link>
              ),
            },
            { label: "Entered", value: `${formatDateTime(b.postedAt)} by ${b.postedBy.fullName}` },
            ...(b.notes ? [{ label: "Notes", value: b.notes }] : []),
          ]}
        />
      </Section>
    </Page>
  );
}
