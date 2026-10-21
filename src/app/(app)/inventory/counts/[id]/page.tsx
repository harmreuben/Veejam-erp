import { notFound } from "next/navigation";

import { formatDateTime, StatusBadge } from "@/components/format";
import { DetailList, Page, PageHeader } from "@/components/page";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { formatQuantity } from "@/lib/units";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getCount } from "@/server/modules/inventory/queries";

import { CancelCountButton, CountSheet } from "../count-forms";

export const metadata = { title: "Stock count" };

export default async function CountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const justPosted = (await searchParams).posted === "1";
  const c = await getCount(getDb(), toActor(user), id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const open = c.status === "DRAFT";
  const canCount = hasPermission(user.role, "inventory.count");
  const countedLines = c.lines.filter((l) => l.countedQuantity !== null);
  const changedLines = countedLines.filter(
    (l) => l.countedQuantity !== (l.systemQuantityAtPost ?? l.expectedQuantity),
  );

  return (
    <Page wide>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {c.number} <StatusBadge status={c.status} />
          </span>
        }
        back={{ href: "/inventory/counts", label: "Stock counts" }}
        actions={open && canCount && <CancelCountButton countId={c.id} />}
      />
      <DetailList
        items={[
          { label: "Warehouse", value: c.warehouse.name },
          { label: "Started", value: `${formatDateTime(c.createdAt)} by ${c.createdBy.fullName}` },
          ...(c.postedAt
            ? [{ label: "Posted", value: `${formatDateTime(c.postedAt)} by ${c.postedBy?.fullName ?? "—"}` }]
            : []),
          ...(c.cancelledAt ? [{ label: "Cancelled", value: formatDateTime(c.cancelledAt) }] : []),
          { label: "Notes", value: c.notes },
        ]}
      />

      {justPosted && c.status === "POSTED" && (
        <div role="status" className="bg-success-soft text-success rounded-md px-4 py-3 text-sm">
          <strong>{c.number} posted.</strong> {countedLines.length} product
          {countedLines.length === 1 ? "" : "s"} counted; {changedLines.length} balance
          {changedLines.length === 1 ? "" : "s"} changed to the counted figure.
        </div>
      )}

      {open && canCount ? (
        <CountSheet
          countId={c.id}
          version={c.version}
          canPost={hasPermission(user.role, "inventory.count.post")}
          lines={c.lines.map((l) => ({
            productId: l.productId,
            sku: l.product.sku,
            name: l.product.name,
            unitsPerPack: l.product.unitsPerPack,
            packsPerCarton: l.product.packsPerCarton,
            expectedQuantity: l.expectedQuantity,
            countedQuantity: l.countedQuantity,
          }))}
        />
      ) : (
        <Table minWidth={720}>
          <THead>
            <tr>
              <TH>Product</TH>
              <TH numeric>Counted</TH>
              <TH numeric>System at posting</TH>
              <TH numeric>Difference</TH>
            </tr>
          </THead>
          <TBody>
            {c.lines.map((l) => {
              const sys = l.systemQuantityAtPost ?? l.expectedQuantity;
              const diff = l.countedQuantity === null ? null : l.countedQuantity - sys;
              return (
                <tr key={l.id}>
                  <TD>
                    {l.product.name}
                    <div className="text-muted-foreground text-xs">{l.product.sku}</div>
                  </TD>
                  <TD numeric>
                    {l.countedQuantity === null ? (
                      <span className="text-muted-foreground">Not counted</span>
                    ) : (
                      formatQuantity(l.countedQuantity, l.product)
                    )}
                  </TD>
                  <TD numeric className="text-muted-foreground">
                    {formatQuantity(sys, l.product)}
                  </TD>
                  <TD numeric className={diff && diff < 0 ? "text-destructive" : diff ? "text-success" : ""}>
                    {diff === null
                      ? "—"
                      : diff === 0
                        ? "None"
                        : `${diff > 0 ? "+" : "−"}${formatQuantity(Math.abs(diff), l.product)}`}
                  </TD>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Page>
  );
}
