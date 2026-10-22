import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { getDb } from "@/server/db/client";
import { getCompanyDisplayName } from "@/server/modules/settings/service";

export async function companyName(): Promise<string> {
  if (!process.env.DATABASE_URL) return DEFAULT_COMPANY_PROFILE.name;
  return getCompanyDisplayName(getDb(), DEFAULT_COMPANY_PROFILE.name);
}

/** The two-column frame shared by sign-in, forgot password and new password. */
export async function AuthShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  const name = await companyName();
  return (
    <div className="flex min-h-dvh flex-col md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-sidebar text-sidebar-foreground flex flex-col justify-between gap-8 px-4 py-4 md:px-12 md:py-12">
        <p className="text-lg font-bold tracking-tight">
          {name} <span className="text-sidebar-muted text-xs font-normal">ERP</span>
        </p>
        <p className="text-sidebar-muted hidden max-w-[34ch] text-sm md:block">
          Orders, invoices, stock and payments for {name}. Staff accounts are created by the owner.
        </p>
      </aside>

      <main className="flex flex-1 items-start justify-center px-4 py-10 md:items-center">
        <div className="grid w-full max-w-sm gap-6">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{intro}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
