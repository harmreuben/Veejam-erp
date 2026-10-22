import { randomUUID } from "node:crypto";

import Link from "next/link";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listWarehouses, productOptions } from "@/server/modules/inventory/queries";

import { TransferForm } from "../../document-forms";

export const metadata = { title: "New stock transfer" };

export default async function NewTransferPage() {
  const user = await pageUser("inventory.transfer");
  if (!user) return <NoAccess what="stock transfers" />;
  const db = getDb();
  const actor = toActor(user);
  const [warehouses, products] = await Promise.all([
    listWarehouses(db, actor, { activeOnly: true }),
    productOptions(db, actor, { includeInactiveWithStock: true }),
  ]);

  return (
    <Page>
      <PageHeader title="New stock transfer" back={{ href: "/inventory/transfers", label: "Transfers" }} />
      {warehouses.length < 2 ? (
        <p className="text-muted-foreground text-sm">
          You need at least two active warehouses to transfer stock.{" "}
          {hasPermission(user, "warehouses.manage") && (
            <Link href="/inventory/warehouses" className="text-primary hover:underline">
              Add a warehouse
            </Link>
          )}
        </p>
      ) : (
        <TransferForm idempotencyKey={randomUUID()} warehouses={warehouses} products={products} />
      )}
    </Page>
  );
}
