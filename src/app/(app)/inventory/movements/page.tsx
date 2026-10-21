import Link from "next/link";

import { param, selectClass } from "@/components/filters";
import { formatDateTime } from "@/components/format";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { StockMovementType } from "@/generated/prisma/enums";
import { formatQuantity } from "@/lib/units";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listMovements, listWarehouses, productOptions } from "@/server/modules/inventory/queries";

import { MOVEMENT_LABELS, sourceHref } from "../labels";

export const metadata = { title: "Stock movements" };

const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : undefined);

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await requireUser();
  const actor = toActor(user);
  const db = getDb();
  const sp = await searchParams;
  const productId = uuid(param(sp.product));
  const warehouseId = uuid(param(sp.warehouse));
  const typeParam = param(sp.type);
  const type = typeParam && typeParam in StockMovementType ? (typeParam as StockMovementType) : undefined;

  const [movements, products, warehouses] = await Promise.all([
    listMovements(db, actor, { productId, warehouseId, type, take: 300 }),
    productOptions(db, actor, { includeInactiveWithStock: true }),
    listWarehouses(db, actor),
  ]);

  return (
    <Page wide>
      <PageHeader
        title="Stock movements"
        description="The stock ledger: every change, who made it and the balance after. Entries can't be edited or deleted; mistakes are corrected by a new entry."
      />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-[14rem] flex-1 gap-1">
          <span className="text-muted-foreground text-xs">Product</span>
          <select name="product" defaultValue={productId ?? ""} className={selectClass}>
            <option value="">All products</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Warehouse</span>
          <select name="warehouse" defaultValue={warehouseId ?? ""} className={selectClass}>
            <option value="">All</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Type</span>
          <select name="type" defaultValue={type ?? ""} className={selectClass}>
            <option value="">All</option>
            {Object.entries(MOVEMENT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>
      <Table minWidth={860}>
        <THead>
          <tr>
            <TH>When</TH>
            <TH>Product</TH>
            <TH>Warehouse</TH>
            <TH>Type</TH>
            <TH>Document</TH>
            <TH numeric>Change</TH>
            <TH numeric>Balance after</TH>
            <TH>By</TH>
          </tr>
        </THead>
        <TBody>
          {movements.length === 0 && <EmptyRow colSpan={8}>No movements match.</EmptyRow>}
          {movements.map((m) => {
            const href = sourceHref(m.sourceType, m.sourceId);
            return (
              <tr key={m.id.toString()}>
                <TD className="whitespace-nowrap">{formatDateTime(m.occurredAt)}</TD>
                <TD>
                  <Link href={`/products/${m.product.id}`} className="hover:underline">
                    {m.product.name}
                  </Link>
                  <div className="text-muted-foreground text-xs">{m.product.sku}</div>
                </TD>
                <TD>{m.warehouse.name}</TD>
                <TD>{MOVEMENT_LABELS[m.type]}</TD>
                <TD>
                  {href ? (
                    <Link href={href} className="text-primary hover:underline">
                      {m.sourceNumber}
                    </Link>
                  ) : (
                    m.sourceNumber
                  )}
                  {m.reason && (
                    <div className="text-muted-foreground max-w-[22ch] truncate text-xs">{m.reason}</div>
                  )}
                </TD>
                <TD numeric className={m.quantity < 0 ? "text-destructive" : "text-success"}>
                  {m.quantity > 0 ? "+" : "−"}
                  {formatQuantity(Math.abs(m.quantity), m.product)}
                </TD>
                <TD numeric>{m.balanceAfter.toLocaleString("en-KE")}</TD>
                <TD className="text-muted-foreground">{m.createdBy?.fullName ?? "—"}</TD>
              </tr>
            );
          })}
        </TBody>
      </Table>
      {movements.length === 300 && (
        <p className="text-muted-foreground text-sm">Showing the latest 300. Filter to see older entries.</p>
      )}
    </Page>
  );
}
