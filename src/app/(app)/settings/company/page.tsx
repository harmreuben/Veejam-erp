import { Page, PageHeader } from "@/components/page";
import { NoAccess } from "@/components/no-access";
import { hasPermission } from "@/server/auth/permissions";
import { requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCompanySettings, getSettingsLastEditor } from "@/server/modules/settings/service";

import { CompanySettingsForm } from "./company-settings-form";

export const metadata = { title: "Company settings" };

const nairobiDateTime = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Nairobi",
});

export default async function CompanySettingsPage() {
  const user = await requireUser();
  if (!hasPermission(user, "settings.view")) return <NoAccess what="company settings" />;
  const db = getDb();
  const settings = await getCompanySettings(db, toActor(user));
  const canEdit = hasPermission(user, "settings.manage");
  const editor = settings.version > 1 ? await getSettingsLastEditor(db, toActor(user)) : null;

  return (
    <Page>
      <PageHeader
        title="Company settings"
        description={
          <>
            <p className="text-muted-foreground text-sm">
              {canEdit
                ? "Changes apply to new documents. Documents already posted keep the details they were issued with."
                : "You can view these details. Only an owner or administrator can change them."}
              {editor && (
                <>
                  {" "}
                  Last changed {nairobiDateTime.format(settings.updatedAt)} by {editor}.
                </>
              )}
            </p>
          </>
        }
      />
      <CompanySettingsForm
        canEdit={canEdit}
        values={{
          name: settings.name,
          telephone: settings.telephone,
          documentEmail: settings.documentEmail,
          country: settings.country,
          currency: settings.currency,
          timezone: settings.timezone,
          businessType: settings.businessType,
          productScope: settings.productScope,
          kraPin: settings.kraPin,
          physicalAddress: settings.physicalAddress,
          postalAddress: settings.postalAddress,
          paymentInstructions: settings.paymentInstructions,
          invoiceTerms: settings.invoiceTerms,
          defaultPaymentTermsDays: settings.defaultPaymentTermsDays,
          tagline: settings.tagline,
          mpesaPaybill: settings.mpesaPaybill,
          mpesaAccount: settings.mpesaAccount,
          vatRegistered: settings.vatRegistered,
          version: settings.version,
        }}
      />
    </Page>
  );
}
