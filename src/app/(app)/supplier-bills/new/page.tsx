import { randomUUID } from "node:crypto";

import { param } from "@/components/filters";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { billFormData } from "@/server/modules/purchasing/payables";
import { isUuid } from "@/server/shared/validation";

import { BillForm } from "../../_purchasing/bill-form";

export const metadata = { title: "Enter a supplier bill" };

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[]>>;
}) {
  const user = await pageUser("bills.manage");
  if (!user) return <NoAccess what="entering supplier bills" />;
  const sp = await searchParams;
  const s = param(sp.supplier);
  const supplierId = s && isUuid(s) ? s : null;
  const data = await billFormData(getDb(), toActor(user), supplierId);
  return (
    <Page wide>
      <PageHeader
        title="Enter a supplier bill"
        description="Copy the supplier's invoice: tick the deliveries it covers, check the amounts match, and add any other charges."
        back={{ href: "/supplier-bills", label: "Supplier bills" }}
      />
      <BillForm
        key={supplierId ?? "none"}
        idempotencyKey={randomUUID()}
        today={data.today}
        suppliers={data.suppliers}
        supplierId={supplierId}
        receipts={data.receipts}
        preselect={param(sp.grn) ?? null}
        accounts={data.accounts}
      />
    </Page>
  );
}
