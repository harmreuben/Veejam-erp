import { notFound } from "next/navigation";

import { formatDateTime, Qty } from "@/components/format";
import { DetailList, Page, PageHeader } from "@/components/page";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { UNIT_LABELS } from "@/lib/units";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getTransfer } from "@/server/modules/inventory/queries";

export const metadata = { title: "Stock transfer" };

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const t = await getTransfer(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <Page>
      <PageHeader title={t.number} back={{ href: "/inventory/transfers", label: "Transfers" }} />
      <DetailList
        items={[
          { label: "Posted", value: `${formatDateTime(t.postedAt)} by ${t.postedBy.fullName}` },
          { label: "From", value: t.fromWarehouse.name },
          { label: "To", value: t.toWarehouse.name },
          { label: "Notes", value: t.notes },
        ]}
      />
      <Table minWidth={520}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>As entered</TH>
            <TH numeric>Pieces moved</TH>
          </tr>
        </THead>
        <TBody>
          {t.lines.map((l) => (
            <tr key={l.id}>
              <TD>
                {l.product.name}
                <div className="text-muted-foreground text-xs">{l.product.sku}</div>
              </TD>
              <TD numeric>
                {l.unitQuantity} {l.unitQuantity === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many}
              </TD>
              <TD numeric>
                <Qty pieces={l.quantity} sizes={l.product} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
