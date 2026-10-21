import { randomUUID } from "node:crypto";

import { notFound } from "next/navigation";

import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { creditableLines } from "@/server/modules/sales/credit-notes";

import { CreditNoteForm } from "./credit-note-form";

export const metadata = { title: "Credit note" };

export default async function NewCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("credit_notes.manage");
  if (!user) return <NoAccess what="credit notes" />;
  const db = getDb();
  const id = (await params).id;
  const data = await creditableLines(db, toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const doc = await db.salesDocument.findUniqueOrThrow({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  const back = { href: `/invoices/${id}`, label: data.invoice.number ?? "Invoice" };
  if (data.invoice.status !== "POSTED") {
    return (
      <Page>
        <PageHeader title="Credit note" back={back} />
        <p className="text-muted-foreground text-sm">Only a posted invoice can be credited.</p>
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader
        title={`Credit note on ${data.invoice.number}`}
        back={back}
        description={
          <>
            {data.invoice.customer.name} · invoice total <Money value={data.invoice.total} />, still owed{" "}
            <Money value={data.invoice.outstanding} />
            {data.invoice.alreadyCredited !== "0.00" && (
              <>
                , already credited <Money value={data.invoice.alreadyCredited} />
              </>
            )}
            . Enter how many of each item to credit; prices and VAT are taken from the invoice.
          </>
        }
      />
      <CreditNoteForm
        invoiceId={id}
        idempotencyKey={randomUUID()}
        pricesIncludeTax={doc.pricesIncludeTax}
        outstanding={data.invoice.outstanding}
        lines={data.lines.map((l) => {
          const orig = doc.lines.find((x) => x.id === l.id)!;
          return {
            ...l,
            discountPercent: orig.discountPercent.toFixed(2),
            taxRate: orig.taxRate.toFixed(4),
          };
        })}
      />
    </Page>
  );
}
