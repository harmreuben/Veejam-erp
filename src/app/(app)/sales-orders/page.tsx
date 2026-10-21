import { SalesListPage } from "../_sales/pages";

export const metadata = { title: "Sales orders" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  return <SalesListPage kind="SALES_ORDER" searchParams={searchParams} />;
}
