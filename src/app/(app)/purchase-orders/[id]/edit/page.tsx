import { notFound, redirect } from "next/navigation";

import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { getPurchaseOrder, purchaseOrderFormData } from "@/server/modules/purchasing/orders";

import { PurchaseOrderForm } from "../../../_purchasing/po-form";

export const metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("purchasing.manage");
  if (!user) return <NoAccess what="editing purchase orders" />;
  const { id } = await params;
  const actor = toActor(user);
  const db = getDb();
  const po = await getPurchaseOrder(db, actor, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (po.status !== "DRAFT") redirect(`/purchase-orders/${id}`);
  const data = await purchaseOrderFormData(db, actor);
  return (
    <Page wide>
      <PageHeader title={`Edit ${po.number}`} back={{ href: `/purchase-orders/${id}`, label: po.number }} />
      <PurchaseOrderForm
        suppliers={data.suppliers}
        warehouses={data.warehouses}
        products={data.products}
        initial={{
          id: po.id,
          version: po.version,
          supplierId: po.supplier.id,
          warehouseId: po.warehouse.id,
          orderDate: po.orderDate,
          expectedDate: po.expectedDate,
          notes: po.notes,
          lines: po.lines.map((l) => ({
            productId: l.productId,
            unit: l.unit,
            quantity: l.quantity,
            unitCost: l.unitCost ?? "",
          })),
        }}
      />
    </Page>
  );
}
