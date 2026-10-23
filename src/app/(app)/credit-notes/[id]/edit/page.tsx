import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound } from "next/navigation";

import { Money } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { correctionForm } from "@/server/modules/sales/correct-credit-note";

import { CreditNoteForm } from "../../../invoices/[id]/credit/credit-note-form";

export const metadata = { title: "Edit credit note" };

/** Owners and admins: correct an issued credit note (it's replaced by a corrected one). */
export default async function EditCreditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("credit_notes.edit");
  if (!user) return <NoAccess what="editing credit notes" />;
  const id = (await params).id;
  const data = await correctionForm(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const cn = data.creditNote;
  const back = { href: `/credit-notes/${cn.id}`, label: cn.number };
  if (cn.deleted || cn.status !== "POSTED") {
    return (
      <Page>
        <PageHeader title={`Edit ${cn.number}`} back={back} />
        <p className="text-muted-foreground text-sm">
          {cn.number} was already changed or deleted.{" "}
          <Link href={`/credit-notes/${cn.id}`} className="text-primary hover:underline">
            Open it
          </Link>{" "}
          to see what replaced it.
        </p>
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader
        title={`Edit ${cn.number}`}
        back={back}
        description={
          <>
            On {data.invoice.number} for {data.invoice.customer} · now <Money value={cn.total} />. Change the
            quantities, the reason or whether the goods came back. When you save, {cn.number} is cancelled
            (its credit, any stock it returned and its accounts entry are undone, dated today) and a corrected
            credit note is issued with the next number. {cn.number} stays on record under
            &ldquo;Deleted&rdquo;.
          </>
        }
      />
      <CreditNoteForm
        invoiceId={data.invoice.id}
        idempotencyKey={randomUUID()}
        pricesIncludeTax={data.invoice.pricesIncludeTax}
        outstanding={data.invoice.outstanding}
        lines={data.lines}
        correcting={{
          creditNoteId: cn.id,
          number: cn.number,
          version: cn.version,
          reason: cn.reason,
          returnsToStock: cn.returnsToStock,
        }}
      />
    </Page>
  );
}
