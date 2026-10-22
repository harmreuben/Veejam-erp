import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDateTime, Money, Qty, StatusBadge } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader, Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, Table } from "@/components/ui/table";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getProduct } from "@/server/modules/catalogue/service";
import { listMovements } from "@/server/modules/inventory/queries";

import { MOVEMENT_LABELS } from "../../inventory/labels";
import { updateProductAction } from "../actions";
import { ProductForm } from "../product-form";

export const metadata = { title: "Product" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("catalogue.view");
  if (!user) return <NoAccess what="products" />;
  const { id } = await params;
  const db = getDb();
  const actor = toActor(user);
  const { product, prices, balances, defaultPriceListId } = await getProduct(db, actor, id).catch(
    (e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    },
  );
  const canSeeStock = hasPermission(user, "inventory.view");
  const movements = canSeeStock ? await listMovements(db, actor, { productId: id, take: 15 }) : [];
  const total = balances.reduce((s, b) => s + b.quantity, 0);

  const lists = [...new Map(prices.map((p) => [p.priceList.id, p.priceList])).values()];

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {product.name} <StatusBadge status={product.status} />
          </span>
        }
        back={{ href: "/products", label: "Products" }}
        description={`${product.sku} · ${product.brand} · ${product.category}`}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          title="Prices"
          actions={
            <Link href="/price-lists" className="text-primary text-sm hover:underline">
              Edit prices
            </Link>
          }
        >
          {lists.length === 0 ? (
            <p className="text-muted-foreground text-sm">No prices yet. Set them under Price lists.</p>
          ) : (
            <Table minWidth={360}>
              <THead>
                <tr>
                  <TH>Price list</TH>
                  <TH numeric>Piece</TH>
                  <TH numeric>Pack</TH>
                  <TH numeric>Carton</TH>
                </tr>
              </THead>
              <TBody>
                {lists.map((l) => (
                  <tr key={l.id}>
                    <TD>
                      {l.name} {l.id === defaultPriceListId && <Badge variant="secondary">Default</Badge>}
                    </TD>
                    {(["PIECE", "PACK", "CARTON"] as const).map((u) => (
                      <TD key={u} numeric>
                        <Money value={prices.find((p) => p.priceList.id === l.id && p.unit === u)?.price} />
                      </TD>
                    ))}
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
        </Section>

        {canSeeStock && (
          <Section title="Stock" description={`Total: ${total.toLocaleString("en-KE")} pieces`}>
            <Table minWidth={320}>
              <THead>
                <tr>
                  <TH>Warehouse</TH>
                  <TH numeric>On hand</TH>
                </tr>
              </THead>
              <TBody>
                {balances.length === 0 && <EmptyRow colSpan={2}>No stock recorded yet.</EmptyRow>}
                {balances.map((b) => (
                  <tr key={b.warehouseId}>
                    <TD>{b.warehouse.name}</TD>
                    <TD numeric>
                      <Qty pieces={b.quantity} sizes={product} />
                    </TD>
                  </tr>
                ))}
              </TBody>
            </Table>
          </Section>
        )}
      </div>

      <Section title="Details">
        <ProductForm
          action={updateProductAction}
          values={product}
          canEdit={hasPermission(user, "catalogue.manage")}
          canSeeCost={hasPermission(user, "catalogue.costs")}
          withPrices={false}
          hasStock={total > 0}
        />
      </Section>

      {canSeeStock && (
        <Section
          title="Recent stock movements"
          actions={
            <Link
              href={`/inventory/movements?product=${product.id}`}
              className="text-primary text-sm hover:underline"
            >
              Full history
            </Link>
          }
        >
          <Table minWidth={640}>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>Warehouse</TH>
                <TH numeric>Change</TH>
                <TH numeric>Balance after</TH>
              </tr>
            </THead>
            <TBody>
              {movements.length === 0 && <EmptyRow colSpan={5}>No movements yet.</EmptyRow>}
              {movements.map((m) => (
                <tr key={m.id.toString()}>
                  <TD className="whitespace-nowrap">{formatDateTime(m.occurredAt)}</TD>
                  <TD>
                    {MOVEMENT_LABELS[m.type]} · {m.sourceNumber}
                  </TD>
                  <TD>{m.warehouse.name}</TD>
                  <TD numeric className={m.quantity < 0 ? "text-destructive" : "text-success"}>
                    {m.quantity > 0 ? "+" : ""}
                    {m.quantity.toLocaleString("en-KE")}
                  </TD>
                  <TD numeric>{m.balanceAfter.toLocaleString("en-KE")}</TD>
                </tr>
              ))}
            </TBody>
          </Table>
        </Section>
      )}
    </Page>
  );
}
