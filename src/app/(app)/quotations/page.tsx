import { SalesListPage } from "../_sales/pages";

export const metadata = { title: "Quotations" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  return <SalesListPage kind="QUOTATION" searchParams={searchParams} />;
}
