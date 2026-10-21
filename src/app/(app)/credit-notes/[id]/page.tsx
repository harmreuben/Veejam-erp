import { SalesDetailPage } from "../../_sales/detail-page";

export const metadata = { title: "Credit note" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { id } = await params;
  return <SalesDetailPage kind="CREDIT_NOTE" id={id} searchParams={searchParams} />;
}
