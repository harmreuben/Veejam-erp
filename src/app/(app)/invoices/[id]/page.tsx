import { SalesDetailPage } from "../../_sales/detail-page";

export const metadata = { title: "Invoices" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const { id } = await params;
  return <SalesDetailPage kind="INVOICE" id={id} searchParams={searchParams} />;
}
