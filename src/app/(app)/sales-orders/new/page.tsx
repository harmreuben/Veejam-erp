import { SalesNewPage } from "../../_sales/pages";

export const metadata = { title: "New sales order" };

export default function Page() {
  return <SalesNewPage kind="SALES_ORDER" />;
}
