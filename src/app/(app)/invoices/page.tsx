import { SalesListPage } from "../_sales/pages";

export const metadata = { title: "Invoices" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  return <SalesListPage kind="INVOICE" searchParams={searchParams} />;
}
