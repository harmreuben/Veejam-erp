import { notFound, redirect } from "next/navigation";

import { NoAccess } from "@/components/no-access";
import { pageUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { isUuid } from "@/server/shared/validation";

/** Supplier bills are part of a stock purchase now: open the purchase a bill belongs to. */
export default async function BillRedirect({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser("purchasing.view");
  if (!user) return <NoAccess what="stock purchases" />;
  const id = (await params).id;
  if (!isUuid(id)) notFound();
  const grn = await getDb().goodsReceipt.findFirst({ where: { billId: id }, select: { id: true } });
  if (!grn) notFound();
  redirect(`/stock-purchases/${grn.id}`);
}
