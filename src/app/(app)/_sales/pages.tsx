import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Layers, Plus } from "lucide-react";

import { FilterBar, param } from "@/components/filters";
import { formatDate, Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import type { SalesDocumentKind, SalesDocumentStatus } from "@/generated/prisma/enums";
import { addDays, todayInNairobi } from "@/lib/dates";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { editorData, getDocument, listDocuments } from "@/server/modules/sales/queries";
import { EDITABLE_STATUSES, KIND_LABELS, STATUS_LABELS } from "@/server/modules/sales/schemas";
import { MANAGE_PERMISSION } from "@/server/modules/sales/service";

import { DocumentEditor } from "./document-editor";
import { SalesStatusBadge } from "./status";

const STATUSES: Record<SalesDocumentKind, SalesDocumentStatus[]> = {
  QUOTATION: ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "CONVERTED", "CANCELLED"],
  SALES_ORDER: ["DRAFT", "CONFIRMED", "INVOICED", "CANCELLED"],
  INVOICE: ["DRAFT", "POSTED", "CANCELLED"],
  CREDIT_NOTE: ["POSTED"],
};

const DESCRIPTIONS: Record<SalesDocumentKind, string> = {
  QUOTATION: "Prices offered to a customer. Turn one into a sales order or an invoice without re-typing.",
  SALES_ORDER: "Confirmed orders reserve their stock, so nobody else can sell it before it's invoiced.",
  INVOICE:
    "New invoices post straight away: they get an INV- number, the stock goes out, and they can't be changed after that (use a credit note). Drafts are kept for invoices that couldn't be posted yet.",
  CREDIT_NOTE:
    "Credit notes reduce what a customer owes, for returned goods or mistakes on a posted invoice.",
};

export async function SalesListPage({
  kind,
  searchParams,
}: {
  kind: SalesDocumentKind;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("sales.view");
  const label = KIND_LABELS[kind];
  if (!user) return <NoAccess what={label.many.toLowerCase()} />;
  const sp = await searchParams;
  const q = param(sp.q);
  const status = (param(sp.status) ?? "ALL") as SalesDocumentStatus | "ALL" | "DELETED";
  const rows = await listDocuments(getDb(), toActor(user), kind, { q, status });
  const canCreate = kind !== "CREDIT_NOTE" && hasPermission(user, MANAGE_PERMISSION[kind]);
  const isInvoice = kind === "INVOICE";

  return (
    <Page wide>
      <PageHeader
        title={label.many}
        description={DESCRIPTIONS[kind]}
        actions={
          canCreate && (
            <>
              {isInvoice && hasPermission(user, "invoices.post") && (
                <Button asChild variant="outline">
                  <Link href="/invoices/batch">
                    <Layers aria-hidden /> Batch of invoices
                  </Link>
                </Button>
              )}
              <Button asChild>
                <Link href={`${label.path}/new`}>
                  <Plus aria-hidden /> New {label.one.toLowerCase()}
                </Link>
              </Button>
            </>
          )
        }
      />
      <FilterBar
        q={q}
        placeholder="Number, customer or customer reference"
        selects={[
          {
            name: "status",
            label: "Status",
            value: status,
            options: [
              { value: "ALL", label: "All" },
              ...STATUSES[kind].map((s) => ({ value: s, label: STATUS_LABELS[s] })),
              ...(isInvoice || kind === "CREDIT_NOTE" ? [{ value: "DELETED", label: "Deleted" }] : []),
            ],
          },
        ]}
      />
      <Table minWidth={720}>
        <THead>
          <tr>
            <TH>Number</TH>
            <TH>Customer</TH>
            <TH>Date</TH>
            <TH>{kind === "QUOTATION" ? "Valid until" : isInvoice ? "Due" : ""}</TH>
            <TH numeric>Total</TH>
            {isInvoice && <TH numeric>Balance</TH>}
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && (
            <EmptyRow colSpan={isInvoice ? 7 : 6} art={q || status !== "ALL" ? "search" : "documents"}>
              {q || status !== "ALL" ? "Nothing matches that search." : `No ${label.many.toLowerCase()} yet.`}
            </EmptyRow>
          )}
          {rows.map((d) => (
            <tr key={d.id} className="hover:bg-muted/50">
              <TD>
                <Link href={`${label.path}/${d.id}`} className="text-primary font-medium hover:underline">
                  {d.number ?? "Draft"}
                </Link>
                {d.historical && <span className="text-muted-foreground ml-1.5 text-xs">old system</span>}
              </TD>
              <TD>
                {d.customer.name} <span className="text-muted-foreground text-xs">{d.customer.code}</span>
              </TD>
              <TD className="whitespace-nowrap">{formatDate(d.issueDate)}</TD>
              <TD className="whitespace-nowrap">
                {kind === "QUOTATION" ? formatDate(d.validUntil) : isInvoice ? formatDate(d.dueDate) : ""}
              </TD>
              <TD numeric>
                <Money value={d.total} />
              </TD>
              {isInvoice && <TD numeric>{d.status === "POSTED" ? <Money value={d.outstanding} /> : ""}</TD>}
              <TD>
                <SalesStatusBadge status={d.status} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}

function serialisableEditorData(data: Awaited<ReturnType<typeof editorData>>) {
  return { ...data, products: data.products.map((p) => ({ ...p, taxCategory: String(p.taxCategory) })) };
}

export async function SalesNewPage({ kind }: { kind: Exclude<SalesDocumentKind, "CREDIT_NOTE"> }) {
  const label = KIND_LABELS[kind];
  const user = await pageUser(MANAGE_PERMISSION[kind]);
  if (!user) return <NoAccess what={`new ${label.many.toLowerCase()}`} />;
  const data = await editorData(getDb(), toActor(user));
  const today = todayInNairobi();
  return (
    <Page wide>
      <PageHeader title={`New ${label.one.toLowerCase()}`} back={{ href: label.path, label: label.many }} />
      {data.customers.length === 0 || data.products.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Add at least one customer and one product with a price first.
        </p>
      ) : (
        <DocumentEditor
          kind={kind}
          data={serialisableEditorData(data)}
          defaults={{ issueDate: today, validUntil: addDays(today, 14), idempotencyKey: randomUUID() }}
        />
      )}
    </Page>
  );
}

export async function SalesEditPage({
  kind,
  id,
}: {
  kind: Exclude<SalesDocumentKind, "CREDIT_NOTE">;
  id: string;
}) {
  const label = KIND_LABELS[kind];
  const user = await pageUser(MANAGE_PERMISSION[kind]);
  if (!user) return <NoAccess what={`editing ${label.many.toLowerCase()}`} />;
  const db = getDb();
  const actor = toActor(user);
  const doc = await getDocument(db, actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (doc.kind !== kind) notFound();
  const data = await editorData(db, actor);
  const today = todayInNairobi();
  const title = doc.number ?? "Draft invoice";
  if (!EDITABLE_STATUSES[kind].includes(doc.status)) {
    return (
      <Page>
        <PageHeader title={`Edit ${title}`} back={{ href: `${label.path}/${id}`, label: title }} />
        <p className="text-muted-foreground text-sm">
          This {label.one.toLowerCase()} is {STATUS_LABELS[doc.status].toLowerCase()} and can no longer be
          edited.
        </p>
      </Page>
    );
  }
  // A customer who has since been deactivated still appears, so the draft can be opened.
  if (!data.customers.some((c) => c.id === doc.customerId)) {
    data.customers.unshift({
      id: doc.customer.id,
      code: doc.customer.code,
      name: `${doc.customer.name} (inactive)`,
      priceListId: doc.customer.priceListId,
      paymentTermsDays: doc.customer.paymentTermsDays,
    });
  }
  return (
    <Page wide>
      <PageHeader title={`Edit ${title}`} back={{ href: `${label.path}/${id}`, label: title }} />
      <DocumentEditor
        kind={kind}
        data={serialisableEditorData(data)}
        defaults={{ issueDate: today, validUntil: addDays(today, 14) }}
        initial={{
          id: doc.id,
          version: doc.version,
          customerId: doc.customerId,
          warehouseId: doc.warehouseId,
          issueDate: doc.issueDay,
          validUntil: doc.validUntilDay,
          customerReference: doc.customerReference,
          notes: doc.notes,
          lines: doc.lines.map((l) => ({
            productId: l.productId,
            unit: l.unit,
            quantity: l.quantity,
            discountPercent: l.discountPercent,
            unitPrice: l.unitPrice,
          })),
          fromSource: !!doc.sourceDocumentId,
          pricesIncludeTax: doc.pricesIncludeTax,
        }}
      />
    </Page>
  );
}
