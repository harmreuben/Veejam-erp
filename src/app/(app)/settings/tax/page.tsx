import { formatDateTime } from "@/components/format";
import { NoAccess } from "@/components/no-access";
import { Page, PageHeader } from "@/components/page";
import { pageUser } from "@/server/auth/guard";
import { hasPermission } from "@/server/auth/permissions";
import { toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listTaxRates, TAX_CATEGORY_LABELS } from "@/server/modules/sales/extras";

import { TaxRateForm } from "./tax-rate-form";

export const metadata = { title: "Tax rates" };

export default async function TaxRatesPage() {
  const user = await pageUser("settings.view");
  if (!user) return <NoAccess what="tax rates" />;
  const rates = await listTaxRates(getDb(), toActor(user));
  const canEdit = hasPermission(user.role, "tax.manage");
  return (
    <Page>
      <PageHeader
        title="Tax rates"
        description={
          <>
            Each product has a tax category; the rate here is applied to it on quotations, orders and
            invoices. Kenyan VAT is set to 16% as at October 2026 — confirm with your accountant. A change
            applies to drafts from their next save; posted invoices keep the rate they were posted with.
            {!canEdit && " Only an owner or administrator can change these."}
          </>
        }
      />
      <div className="grid gap-4">
        {rates.map((r) => (
          <div key={r.category} className="bg-card grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{TAX_CATEGORY_LABELS[r.category]}</h2>
              <span className="text-muted-foreground text-xs">
                {r.updatedBy
                  ? `Changed ${formatDateTime(r.updatedAt)} by ${r.updatedBy.fullName}`
                  : "Set at installation"}
              </span>
            </div>
            <TaxRateForm
              category={r.category}
              name={r.name}
              rate={Number(r.rate).toString()}
              canEdit={canEdit}
            />
          </div>
        ))}
      </div>
    </Page>
  );
}
