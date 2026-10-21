import { notFound } from "next/navigation";

import { formatDateTime, Qty } from "@/components/format";
import { DetailList, Page, PageHeader } from "@/components/page";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { UNIT_LABELS } from "@/lib/units";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getAdjustment } from "@/server/modules/inventory/queries";
import { ADJUSTMENT_REASON_LABELS } from "@/server/modules/inventory/schemas";

export const metadata = { title: "Stock adjustment" };

export default async function AdjustmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const a = await getAdjustment(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  return (
    <Page>
      <PageHeader title={a.number} back={{ href: "/inventory/adjustments", label: "Adjustments" }} />
      <DetailList
        items={[
          { label: "Posted", value: `${formatDateTime(a.postedAt)} by ${a.postedBy.fullName}` },
          { label: "Warehouse", value: a.warehouse.name },
          { label: "Reason", value: ADJUSTMENT_REASON_LABELS[a.reason] },
          { label: "Notes", value: a.notes },
        ]}
      />
      <Table minWidth={560}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>As entered</TH>
            <TH numeric>Change in pieces</TH>
          </tr>
        </THead>
        <TBody>
          {a.lines.map((l) => (
            <tr key={l.id}>
              <TD>
                {l.product.name}
                <div className="text-muted-foreground text-xs">{l.product.sku}</div>
              </TD>
              <TD numeric>
                {l.unitQuantity > 0 ? "+" : "−"}
                {Math.abs(l.unitQuantity)}{" "}
                {Math.abs(l.unitQuantity) === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many}
              </TD>
              <TD numeric className={l.quantity < 0 ? "text-destructive" : "text-success"}>
                {l.quantity > 0 ? "+" : "−"}
                <Qty pieces={Math.abs(l.quantity)} sizes={l.product} />
              </TD>
            </tr>
          ))}
        </TBody>
      </Table>
    </Page>
  );
}
