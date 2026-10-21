import { SalesEditPage } from "../../../_sales/pages";

export const metadata = { title: "Edit" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesEditPage kind="INVOICE" id={id} />;
}
