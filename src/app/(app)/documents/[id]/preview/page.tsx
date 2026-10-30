import { FileDown } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LogoMark } from "@/components/brand/logo";
import { NoAccess } from "@/components/no-access";
import { Button } from "@/components/ui/button";
import { formatKES, toDecimal } from "@/lib/money";
import { formatRate } from "@/lib/sales-math";
import { UNIT_LABELS } from "@/lib/units";
import { cn } from "@/lib/utils";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { KIND_LABELS } from "@/server/modules/sales/schemas";
import { loadPrintableDocument, type Printable } from "@/server/modules/sales/pdf";

import { PrintButton } from "./print-button";

export const metadata = { title: "Print preview" };

/*
 * An invoice, quotation, order or credit note as an A4 page, to read on screen
 * and print from the browser. It is built from exactly the same data as the
 * PDF (loadPrintableDocument): posted documents show the company and customer
 * details frozen when they were posted, and every figure comes from the
 * document itself. Nothing is recalculated here except the balance due.
 */

const STATUS_TONE: Record<NonNullable<Printable["status"]>["tone"], string> = {
  green: "bg-[#e3f5ec] text-[#11804f]",
  amber: "bg-[#fdf3e1] text-[#9a5b0b]",
  red: "bg-[#fde8e8] text-[#c23b3b]",
  grey: "bg-[#eef2f6] text-[#5f6b7e]",
};

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="documents" />;
  const id = (await params).id;
  const db = getDb();
  const doc = await loadPrintableDocument(db, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const kind = doc.variant as keyof typeof KIND_LABELS;
  const back = `${KIND_LABELS[kind].path}/${id}`;
  const isInvoice = doc.variant === "INVOICE";
  const kes = (v: string) => formatKES(v);
  const linesGross = doc.lines.reduce((s, l) => s.plus(l.grossAmount), toDecimal(0));
  const multipleRates = new Set(doc.lines.map((l) => l.taxRate)).size > 1;
  const balance = toDecimal(doc.totals.total)
    .minus(doc.totals.amountPaid)
    .minus(doc.totals.amountCredited ?? "0");
  const totals: { k: string; v: string; strong?: boolean; due?: boolean }[] = [];
  if (doc.pricesIncludeTax) totals.push({ k: "Inclusive subtotal", v: kes(linesGross.toFixed(2)) });
  if (!toDecimal(doc.totals.discountTotal).isZero())
    totals.push({ k: "Discount", v: `− ${kes(doc.totals.discountTotal)}` });
  totals.push({ k: "Taxable amount (excl. VAT)", v: kes(doc.totals.subtotal) });
  totals.push({
    k: multipleRates ? "VAT" : `VAT @ ${formatRate(doc.lines[0]?.taxRate ?? "16")}`,
    v: kes(doc.totals.taxTotal),
  });
  totals.push({ k: "Total", v: kes(doc.totals.total), strong: true });
  if (isInvoice && !doc.draft) {
    totals.push({ k: "Amount paid", v: kes(doc.totals.amountPaid) });
    if (!toDecimal(doc.totals.amountCredited ?? "0").isZero())
      totals.push({ k: "Credited", v: kes(doc.totals.amountCredited!) });
    totals.push({ k: "Balance due", v: kes(balance.toFixed(2)), due: true });
  }
  const stamp = doc.cancelled ? (doc.stampWord ?? "CANCELLED") : doc.draft ? "DRAFT" : null;

  return (
    <div className="mx-auto grid w-full max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:px-8 print:block print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="grid gap-0.5">
          <Link href={back} className="text-muted-foreground hover:text-foreground w-fit text-sm">
            ← Back to {doc.number}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {doc.title === "INVOICE"
              ? "Tax invoice"
              : doc.title.toLowerCase().replace(/^./, (c) => c.toUpperCase())}{" "}
            {doc.number} · print preview
          </h1>
          <p className="text-muted-foreground text-sm">
            A4, exactly as it prints. To keep a file, print and choose &ldquo;Save as PDF&rdquo;, or download
            the PDF.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={`/documents/${id}/pdf?download`}>
              <FileDown aria-hidden /> Download PDF
            </a>
          </Button>
          <PrintButton />
        </div>
      </div>

      {/* The paper stays white in dark mode, as it prints. Scrolls sideways on a phone. */}
      <div className="overflow-x-auto pb-2 print:overflow-visible print:p-0">
        <article
          aria-label={`${doc.title} ${doc.number}`}
          className="vj-a4 relative mx-auto box-border min-h-[297mm] w-[210mm] bg-white p-[14mm] text-[13px] leading-snug text-[#202938] shadow-[0_2px_24px_rgb(20_43_74/0.12)] ring-1 ring-[#e3e8ef] max-sm:[zoom:0.44] sm:max-lg:[zoom:0.84] print:min-h-0 print:w-auto print:[zoom:1] print:p-0 print:shadow-none print:ring-0"
        >
          {stamp && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 grid [transform:rotate(-24deg)] place-items-center overflow-hidden text-[110px] font-black tracking-widest text-[#dc4c4c]/10 select-none"
            >
              {stamp}
            </div>
          )}

          {/* Company and document header */}
          <header className="flex items-start justify-between gap-6 border-b-2 border-[#142b4a] pb-5">
            <div className="flex gap-3">
              <LogoMark tile="brand" className="size-12" />
              <div className="grid gap-0.5">
                <div className="text-xl font-bold text-[#142b4a]">{doc.company.name}</div>
                {doc.company.tagline && (
                  <div className="text-[12px] font-medium text-[#0f7c78]">{doc.company.tagline}</div>
                )}
                <div className="mt-1 grid gap-0.5 text-[11.5px] text-[#5f6b7e]">
                  {doc.company.address && <div>{doc.company.address}</div>}
                  {(doc.company.telephone || doc.company.email) && (
                    <div>
                      {doc.company.telephone && <>Tel: {doc.company.telephone}</>}
                      {doc.company.telephone && doc.company.email && " · "}
                      {doc.company.email && <>Email: {doc.company.email}</>}
                    </div>
                  )}
                  {doc.company.kraPin && (
                    <div className="font-mono text-[11px] text-[#202938]">
                      KRA PIN: {doc.company.kraPin}
                      {doc.company.vatRegistered && " · VAT registered"}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="grid justify-items-end gap-1.5 text-right">
              <div className="rounded bg-[#142b4a] px-3 py-1 text-[12px] font-bold tracking-[0.12em] text-white">
                {isInvoice ? "TAX INVOICE" : doc.title}
              </div>
              <div className="font-mono text-xl font-bold text-[#142b4a]">{doc.number}</div>
              {doc.status && (
                <span
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-semibold",
                    STATUS_TONE[doc.status.tone],
                  )}
                >
                  {doc.status.label}
                </span>
              )}
            </div>
          </header>

          {/* Customer and document details */}
          <section className="grid grid-cols-2 gap-8 border-b border-[#e3e8ef] py-5">
            <div className="grid content-start gap-1">
              <div className="text-[10.5px] font-semibold tracking-[0.1em] text-[#5f6b7e] uppercase">
                Bill to
              </div>
              <div className="text-[15px] font-semibold">{doc.customer.name}</div>
              {doc.customer.lines.map((l) => (
                <div key={l} className="text-[12px] text-[#5f6b7e]">
                  {l}
                </div>
              ))}
            </div>
            <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 text-[12px]">
              {doc.meta.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-[#5f6b7e]">{k}</dt>
                  <dd className="text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Lines */}
          <table className="mt-5 w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-[#142b4a] text-left text-[10.5px] tracking-[0.06em] text-white uppercase">
                <th className="px-2 py-2 font-semibold">#</th>
                <th className="px-2 py-2 font-semibold">Product</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 text-right font-semibold">Unit price</th>
                <th className="px-2 py-2 text-center font-semibold">VAT</th>
                <th className="px-2 py-2 text-right font-semibold">VAT amt</th>
                <th className="px-2 py-2 text-right font-semibold">
                  {doc.pricesIncludeTax ? "Amount (incl.)" : "Amount (excl.)"}
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => {
                const unitNote =
                  l.unit === "PACK"
                    ? null
                    : l.quantity === 1
                      ? UNIT_LABELS[l.unit].one
                      : UNIT_LABELS[l.unit].many;
                return (
                  <tr
                    key={i}
                    className="border-b border-[#e3e8ef] align-top even:bg-[#f7f9fc] print:break-inside-avoid"
                  >
                    <td className="px-2 py-2 text-[#5f6b7e]">{i + 1}</td>
                    <td className="px-2 py-2">
                      <div className="font-semibold">{l.description}</div>
                      <div className="font-mono text-[10.5px] text-[#5f6b7e]">{l.sku}</div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono whitespace-nowrap">
                      {unitNote ? `${l.quantity} ${unitNote}` : l.quantity}
                    </td>
                    <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{kes(l.unitPrice)}</td>
                    <td className="px-2 py-2 text-center text-[#5f6b7e]">{formatRate(l.taxRate)}</td>
                    <td className="px-2 py-2 text-right font-mono whitespace-nowrap text-[#5f6b7e]">
                      {kes(l.taxAmount)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-semibold whitespace-nowrap">
                      {kes(doc.pricesIncludeTax ? l.grossAmount : l.netAmount)}
                      {!toDecimal(l.discountPercent).isZero() && (
                        <div className="text-[10.5px] font-normal text-[#5f6b7e]">
                          less {formatRate(l.discountPercent)}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals and payment */}
          <section className="mt-5 grid grid-cols-[1fr_auto] gap-8 print:break-inside-avoid">
            <div className="grid content-start gap-3 text-[12px]">
              {isInvoice && (doc.company.paybill || doc.company.paymentInstructions) && (
                <div className="rounded border border-[#e3e8ef] p-3">
                  <div className="mb-1 text-[10.5px] font-semibold tracking-[0.1em] text-[#0f7c78] uppercase">
                    How to pay
                  </div>
                  {doc.company.paybill && (
                    <div>
                      M-Pesa paybill <span className="font-mono font-semibold">{doc.company.paybill}</span>
                      {doc.company.account && (
                        <>
                          , account <span className="font-mono font-semibold">{doc.company.account}</span>
                        </>
                      )}
                    </div>
                  )}
                  {doc.company.paymentInstructions && (
                    <div className="whitespace-pre-line text-[#5f6b7e]">
                      {doc.company.paymentInstructions}
                    </div>
                  )}
                </div>
              )}
              {doc.notes && (
                <div>
                  <div className="text-[10.5px] font-semibold tracking-[0.1em] text-[#5f6b7e] uppercase">
                    Notes
                  </div>
                  <div className="whitespace-pre-line">{doc.notes}</div>
                </div>
              )}
              {isInvoice && doc.company.terms && (
                <div>
                  <div className="text-[10.5px] font-semibold tracking-[0.1em] text-[#5f6b7e] uppercase">
                    Terms
                  </div>
                  <div className="whitespace-pre-line text-[#5f6b7e]">{doc.company.terms}</div>
                </div>
              )}
            </div>
            <dl className="grid min-w-[78mm] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 self-start text-[12.5px]">
              {totals.map((t) => (
                <div
                  key={t.k}
                  className={cn(
                    "contents",
                    t.strong &&
                      "[&>*]:border-t-2 [&>*]:border-[#142b4a] [&>*]:pt-2 [&>*]:text-[15px] [&>*]:font-bold [&>*]:text-[#142b4a]",
                    t.due && "[&>*]:font-bold [&>*]:text-[#c23b3b]",
                  )}
                >
                  <dt>{t.k}</dt>
                  <dd className="text-right font-mono whitespace-nowrap">{t.v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <footer className="mt-10 flex items-end justify-between gap-6 border-t border-[#e3e8ef] pt-4 text-[11px] text-[#5f6b7e]">
            <div>{doc.footerNote ?? "Thank you for your business."}</div>
            <div className="w-48 border-t border-[#202938] pt-1 text-center text-[#202938]">
              Authorized signature
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
