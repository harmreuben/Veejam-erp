import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppStarted } from "@/components/count-up";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getCompanyDisplayName } from "@/server/modules/settings/service";

// Always render per request: these pages are per-user and show live business data.
// Never prerender at build time, whatever the build environment looks like.
export const dynamic = "force-dynamic";

/** Every page in this group requires a signed-in, active ERP user. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // Both at once: the sign-in check and the company name don't depend on each other.
  const [user, companyName, cookieStore] = await Promise.all([
    requireUser(),
    getCompanyDisplayName(getDb(), DEFAULT_COMPANY_PROFILE.name),
    cookies(),
  ]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar companyName={companyName} user={user} permissions={user.permissions} theme={theme} />
      <main className="min-w-0 flex-1">{children}</main>
      <AppStarted />
    </div>
  );
}
