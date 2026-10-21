import { SalesListPage } from "../_sales/pages";

export const metadata = { title: "Credit notes" };

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  return <SalesListPage kind="CREDIT_NOTE" searchParams={searchParams} />;
}
