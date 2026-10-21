import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";

import { createSupplierAction } from "../actions";
import { EMPTY_SUPPLIER, SupplierForm } from "../supplier-form";

export const metadata = { title: "Add supplier" };

export default async function NewSupplierPage() {
  const user = await pageUser("suppliers.manage");
  if (!user) return <NoAccess what="adding suppliers" />;
  return (
    <Page>
      <PageHeader
        title="Add supplier"
        back={{ href: "/suppliers", label: "Suppliers" }}
        description="A code (SUP-…) is assigned when you save."
      />
      <SupplierForm action={createSupplierAction} values={EMPTY_SUPPLIER} canEdit />
    </Page>
  );
}
