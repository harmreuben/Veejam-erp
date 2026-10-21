import { randomUUID } from "node:crypto";

import Link from "next/link";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listWarehouses, productOptions } from "@/server/modules/inventory/queries";
import { ADJUSTMENT_REASON_LABELS, REASON_DIRECTIONS } from "@/server/modules/inventory/schemas";

import { AdjustmentForm } from "../../document-forms";

export const metadata = { title: "New stock adjustment" };

export default async function NewAdjustmentPage() {
  const user = await pageUser("inventory.adjust");
  if (!user) return <NoAccess what="stock adjustments" />;
  const db = getDb();
  const actor = toActor(user);
  const [warehouses, products] = await Promise.all([
    listWarehouses(db, actor, { activeOnly: true }),
    productOptions(db, actor, { includeInactiveWithStock: true }),
  ]);

  return (
    <Page>
      <PageHeader
        title="New stock adjustment"
        back={{ href: "/inventory/adjustments", label: "Adjustments" }}
        description={
          <>
            For opening stock after a physical count, a{" "}
            <Link href="/inventory/counts" className="text-primary hover:underline">
              stock count
            </Link>{" "}
            is usually better: it sets every product to the counted figure in one step.
          </>
        }
      />
      {products.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Add products first.{" "}
          <Link href="/products/new" className="text-primary hover:underline">
            Add a product
          </Link>
        </p>
      ) : (
        <AdjustmentForm
          idempotencyKey={randomUUID()}
          warehouses={warehouses}
          products={products}
          reasons={Object.entries(ADJUSTMENT_REASON_LABELS).map(([value, label]) => ({
            value,
            label,
            directions: REASON_DIRECTIONS[value as keyof typeof REASON_DIRECTIONS],
          }))}
        />
      )}
    </Page>
  );
}
