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
  if (!hasPermission(user.role, "settings.view")) return <NoAccess what="company settings" />;
  const db = getDb();
  const settings = await getCompanySettings(db, toActor(user));
  const canEdit = hasPermission(user.role, "settings.manage");
  const editor = settings.version > 1 ? await getSettingsLastEditor(db, toActor(user)) : null;

  return (
    <div className="mx-auto grid max-w-4xl gap-6 px-4 py-8 md:px-10 md:py-12">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Company settings</h1>
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
      </header>
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
          version: settings.version,
        }}
      />
    </div>
  );
}
