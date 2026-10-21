import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";

import { formatDateTime } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { DetailList, Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatKenyanPhone } from "@/lib/phone";
import { UNIT_LABELS } from "@/lib/units";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getDeliveryNote } from "@/server/modules/sales/extras";

import { ConfirmButton } from "../../_sales/document-actions";
import { DeliveryStatusBadge } from "../../_sales/status";

export const metadata = { title: "Delivery note" };

export default async function DeliveryNotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("sales.view");
  if (!user) return <NoAccess what="deliveries" />;
  const note = await getDeliveryNote(getDb(), toActor(user), (await params).id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const inv = note.invoice;
  const canManage = hasPermission(user.role, "delivery.manage");
  const base = { id: note.id, version: note.version };
  const open = note.status === "PREPARED" || note.status === "DISPATCHED";

  return (
    <Page>
      <PageHeader
        back={{ href: "/deliveries", label: "Deliveries" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {note.number} <DeliveryStatusBadge status={note.status} />
          </span>
        }
        description={
          <>
            For invoice{" "}
            <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
              {inv.number}
            </Link>{" "}
            · {inv.customer.name}
          </>
        }
        actions={
          <Button variant="outline" asChild>
            <a href={`/deliveries/${note.id}/pdf`} target="_blank" rel="noopener">
              <FileDown aria-hidden /> Print delivery note
            </a>
          </Button>
        }
      />

      {canManage && open && (
        <div className="flex flex-wrap gap-2">
          {note.status === "PREPARED" && (
            <ConfirmButton
              delivery
              variant="default"
              label="Dispatch…"
              title={`Dispatch ${note.number}`}
              description={<p>Record the vehicle and driver taking the goods.</p>}
              fields={[
                { name: "vehicle", label: "Vehicle (registration)" },
                { name: "driver", label: "Driver" },
              ]}
              confirmLabel="Mark dispatched"
              hidden={{ ...base, intent: "dispatch" }}
            />
          )}
          <ConfirmButton
            delivery
            variant={note.status === "DISPATCHED" ? "default" : "outline"}
            label="Mark delivered…"
            title={`Delivered: ${note.number}`}
            description={<p>Who signed for the goods at {inv.customer.name}?</p>}
            fields={[{ name: "receivedBy", label: "Received by", required: true }]}
            confirmLabel="Mark delivered"
            hidden={{ ...base, intent: "delivered" }}
          />
          <ConfirmButton
            delivery
            variant="ghost"
            destructive
            label="Cancel delivery…"
            title={`Cancel ${note.number}?`}
            description={
              <p>
                The invoice and stock are not changed. If goods come back, record a return (credit notes
                arrive in Phase 5).
              </p>
            }
            fields={[{ name: "reason", label: "Reason", required: true }]}
            confirmLabel="Cancel delivery"
            hidden={{ ...base, intent: "cancel" }}
          />
        </div>
      )}

      <Section title="Delivery">
        <DetailList
          items={[
            { label: "Customer", value: `${inv.customer.name} (${inv.customer.code})` },
            {
              label: "Address",
              value: [inv.customer.physicalAddress, inv.customer.town].filter(Boolean).join(", ") || null,
            },
            { label: "Phone", value: inv.customer.phone ? formatKenyanPhone(inv.customer.phone) : null },
            { label: "From", value: inv.warehouse.name },
            { label: "Vehicle", value: note.vehicle },
            { label: "Driver", value: note.driver },
            { label: "Dispatched", value: note.dispatchedAt ? formatDateTime(note.dispatchedAt) : null },
            { label: "Delivered", value: note.deliveredAt ? formatDateTime(note.deliveredAt) : null },
            { label: "Received by", value: note.receivedBy },
            { label: "Made", value: `${formatDateTime(note.createdAt)} by ${note.createdBy.fullName}` },
            ...(note.notes
              ? [{ label: "Notes", value: <span className="whitespace-pre-line">{note.notes}</span> }]
              : []),
          ]}
        />
      </Section>

      <Section title="Goods">
        <Table minWidth={480}>
          <THead>
            <tr>
              <TH>Product</TH>
              <TH numeric>Quantity</TH>
              <TH numeric>Pieces</TH>
            </tr>
          </THead>
          <TBody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <TD>
                  <div className="font-medium">{l.description}</div>
                  <div className="text-muted-foreground text-xs">{l.sku}</div>
                </TD>
                <TD numeric>
                  {l.quantity} {l.quantity === 1 ? UNIT_LABELS[l.unit].one : UNIT_LABELS[l.unit].many}
                </TD>
                <TD numeric>{l.pieces.toLocaleString("en-KE")}</TD>
              </tr>
            ))}
          </TBody>
        </Table>
      </Section>
    </Page>
  );
}
