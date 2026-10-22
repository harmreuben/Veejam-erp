import { randomUUID } from "node:crypto";

import { param } from "@/components/filters";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { receiptFormData } from "@/server/modules/purchasing/receipts";

import { ReceiveForm } from "../../_purchasing/receive-form";

export const metadata = { title: "Receive goods" };

export default async function ReceiveGoodsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("goods.receive");
  if (!user) return <NoAccess what="receiving goods" />;
  const data = await receiptFormData(getDb(), toActor(user), param((await searchParams).po));
  return (
    <Page wide>
      <PageHeader
        title="Receive goods"
        description="Record what arrived from a supplier. The stock goes in at cost straight away."
        back={{ href: "/goods-received", label: "Goods received" }}
      />
      <ReceiveForm
        key={data.order?.id ?? "none"}
        idempotencyKey={randomUUID()}
        today={data.today}
        showCosts={data.showCosts}
        orders={data.orders}
        order={data.order}
        suppliers={data.suppliers}
        warehouses={data.warehouses}
        products={data.products}
      />
    </Page>
  );
}
