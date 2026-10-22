import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, formatDateTime, Money } from "@/components/format";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { toDecimal } from "@/lib/money";
import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getJournalEntry } from "@/server/modules/accounting/service";

import { SOURCE_LABELS } from "../../labels";

export const metadata = { title: "Journal entry" };

function sourceHref(type: string, id: string | null) {
  if (!id) return null;
  if (type === "Invoice") return `/invoices/${id}`;
  if (type === "Payment" || type === "PaymentReversal") return `/payments/${id}`;
  if (type === "CreditNote") return `/credit-notes/${id}`;
  if (type === "GoodsReceipt") return `/goods-received/${id}`;
  if (type === "SupplierBill" || type === "SupplierBillCancelled") return `/supplier-bills/${id}`;
  if (type === "SupplierPayment" || type === "SupplierPaymentReversal") return `/supplier-payments/${id}`;
  if (type === "StockAdjustment") return `/inventory/adjustments/${id}`;
  if (type === "StockCount") return `/inventory/counts/${id}`;
  if (type === "StockRevaluation" || type === "OpeningInventory") return `/reports/stock`;
  return null;
}

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("accounting.view");
  if (!user) return <NoAccess what="the accounts" />;
  const e = await getJournalEntry(getDb(), toActor(user), (await params).id).catch((err: unknown) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const href = sourceHref(e.sourceType, e.sourceId);
  const total = e.lines.reduce((s, l) => s.plus(l.debit), toDecimal(0)).toFixed(2);
  return (
    <Page>
      <PageHeader
        back={{ href: "/accounting/journal", label: "Journal" }}
        title={e.number}
        description={e.description}
      />
      <Section title="Details">
        <DetailList
          items={[
            { label: "Date", value: formatDate(e.date) },
            {
              label: "From",
              value: (
                <>
                  {SOURCE_LABELS[e.sourceType] ?? e.sourceType}
                  {e.sourceNumber &&
                    (href ? (
                      <>
                        {" "}
                        <Link href={href} className="text-primary hover:underline">
                          {e.sourceNumber}
                        </Link>
                      </>
                    ) : (
                      ` ${e.sourceNumber}`
                    ))}
                </>
              ),
            },
            { label: "Posted", value: `${formatDateTime(e.createdAt)} by ${e.createdBy.fullName}` },
          ]}
        />
      </Section>
      <Table minWidth={620}>
        <THead>
          <tr>
            <TH>Account</TH>
            <TH>Note</TH>
            <TH numeric>Debit</TH>
            <TH numeric>Credit</TH>
          </tr>
        </THead>
        <TBody>
          {e.lines.map((l) => (
            <tr key={l.id}>
              <TD>
                <Link href={`/accounting/accounts/${l.accountId}`} className="hover:underline">
                  <span className="font-mono text-xs">{l.account.code}</span> {l.account.name}
                </Link>
              </TD>
              <TD className="text-muted-foreground">
                {l.customer ? l.customer.name : null}
                {l.description}
              </TD>
              <TD numeric>{toDecimal(l.debit).isZero() ? "" : <Money value={l.debit} />}</TD>
              <TD numeric>{toDecimal(l.credit).isZero() ? "" : <Money value={l.credit} />}</TD>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <TD colSpan={2}>Totals</TD>
            <TD numeric>
              <Money value={total} />
            </TD>
            <TD numeric>
              <Money value={total} />
            </TD>
          </tr>
        </TBody>
      </Table>
    </Page>
  );
}
