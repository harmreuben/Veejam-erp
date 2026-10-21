import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { CUSTOMER_TYPE_LABELS } from "@/server/modules/customers/schemas";
import { listPriceLists } from "@/server/modules/pricing/service";

import { createCustomerAction } from "../actions";
import { CustomerForm, EMPTY_CUSTOMER } from "../customer-form";

export const metadata = { title: "Add customer" };

export default async function NewCustomerPage() {
  const user = await pageUser("customers.manage");
  if (!user) return <NoAccess what="adding customers" />;
  const lists = hasPermission(user.role, "catalogue.view")
    ? await listPriceLists(getDb(), toActor(user))
    : [];

  return (
    <Page>
      <PageHeader
        title="Add customer"
        back={{ href: "/customers", label: "Customers" }}
        description="An account number (CUS-…) is assigned when you save."
      />
      <CustomerForm
        action={createCustomerAction}
        values={EMPTY_CUSTOMER}
        types={Object.entries(CUSTOMER_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        priceLists={lists
          .filter((l) => l.status === "ACTIVE")
          .map((l) => ({ id: l.id, label: `${l.name} (${l.code})` }))}
        canCredit={hasPermission(user.role, "customers.credit")}
        canEdit
        isNew
      />
    </Page>
  );
}
