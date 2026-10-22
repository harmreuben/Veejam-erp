import Link from "next/link";

import { param } from "@/components/filters";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { purchaseOrderFormData } from "@/server/modules/purchasing/orders";

import { PurchaseOrderForm } from "../../_purchasing/po-form";

export const metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("purchasing.manage");
  if (!user) return <NoAccess what="creating purchase orders" />;
  const data = await purchaseOrderFormData(getDb(), toActor(user));
  const supplier = param((await searchParams).supplier) ?? "";
  return (
    <Page wide>
      <PageHeader title="New purchase order" back={{ href: "/purchase-orders", label: "Purchase orders" }} />
      {data.suppliers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Add a supplier first under{" "}
          <Link className="text-primary underline" href="/suppliers/new">
            Suppliers
          </Link>
          .
        </p>
      ) : (
        <PurchaseOrderForm
          suppliers={data.suppliers}
          warehouses={data.warehouses}
          products={data.products}
          initial={{
            supplierId: data.suppliers.some((s) => s.id === supplier) ? supplier : "",
            warehouseId: data.warehouses[0]?.id ?? "",
            orderDate: data.today,
            expectedDate: null,
            notes: null,
            lines: [],
          }}
        />
      )}
    </Page>
  );
}
