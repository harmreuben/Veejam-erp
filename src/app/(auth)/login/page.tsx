import { redirect } from "next/navigation";

import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { getSession } from "@/server/auth/session";
import { isSupabaseConfigured } from "@/server/auth/supabase";
import { getDb } from "@/server/db/client";
import { getCompanyDisplayName } from "@/server/modules/settings/service";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  "no-access": "Your account hasn't been given access to the ERP yet. Ask the owner to grant access.",
  deactivated: "This account has been deactivated. Contact the business owner.",
};

async function companyName(): Promise<string> {
  if (!process.env.DATABASE_URL) return DEFAULT_COMPANY_PROFILE.name;
  return getCompanyDisplayName(getDb(), DEFAULT_COMPANY_PROFILE.name);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;
  const configured = isSupabaseConfigured();

  if (configured) {
    const session = await getSession();
    if (session.kind === "user") redirect("/");
  }

  const name = await companyName();
  const notice = reason ? REASONS[reason] : undefined;

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
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-muted-foreground text-sm">
              Use the email and password the owner set up for you.
            </p>
          </div>

          {notice && (
            <p role="status" className="bg-warning-soft text-warning rounded-md px-3 py-2 text-sm">
              {notice}
            </p>
          )}

          {!configured && (
            <div
              role="status"
              className="bg-warning-soft text-warning grid gap-1 rounded-md px-3 py-2 text-sm"
            >
              <strong className="font-semibold">Sign-in isn&apos;t set up yet.</strong>
              <span>
                Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the
                app. See docs/DEPLOYMENT.md.
              </span>
            </div>
          )}

          <LoginForm next={next} disabled={!configured} />
        </div>
      </main>
    </div>
  );
}
