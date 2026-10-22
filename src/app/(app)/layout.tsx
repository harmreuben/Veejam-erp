import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCompanyDisplayName } from "@/server/modules/settings/service";

// Always render per request: these pages are per-user and show live business data.
// Never prerender at build time, whatever the build environment looks like.
export const dynamic = "force-dynamic";

/** Every page in this group requires a signed-in, active ERP user. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Both at once: the sign-in check and the company name don't depend on each other.
  const [user, companyName] = await Promise.all([
    requireUser(),
    getCompanyDisplayName(getDb(), DEFAULT_COMPANY_PROFILE.name),
  ]);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar companyName={companyName} user={user} permissions={user.permissions} />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
