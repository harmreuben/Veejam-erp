import { SalesDetailPage } from "../../_sales/detail-page";

export const metadata = { title: "Quotations" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { id } = await params;
  return <SalesDetailPage kind="QUOTATION" id={id} searchParams={searchParams} />;
}
