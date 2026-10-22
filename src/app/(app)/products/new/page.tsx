import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";

import { createProductAction } from "../actions";
import { EMPTY_PRODUCT, ProductForm } from "../product-form";

export const metadata = { title: "Add product" };

export default async function NewProductPage() {
  const user = await pageUser("catalogue.manage");
  if (!user) return <NoAccess what="adding products" />;
  return (
    <Page>
      <PageHeader title="Add product" back={{ href: "/products", label: "Products" }} />
      <ProductForm
        action={createProductAction}
        values={EMPTY_PRODUCT}
        canEdit
        canSeeCost={hasPermission(user, "catalogue.costs")}
        withPrices={hasPermission(user, "pricing.manage")}
      />
    </Page>
  );
}
