import { SalesNewPage } from "../../_sales/pages";

export const metadata = { title: "New invoice" };

export default function Page() {
  return <SalesNewPage kind="INVOICE" />;
}
