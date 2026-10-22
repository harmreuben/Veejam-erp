import Link from "next/link";
import { redirect } from "next/navigation";

import { getSession } from "@/server/auth/session";
import { isSupabaseConfigured } from "@/server/auth/supabase";

import { AuthShell } from "../_shell/auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  "no-access": "Your account hasn't been given access to the ERP yet. Ask the owner to grant access.",
  reset: "Your password has been changed. Sign in with the new one.",
  deactivated: "This account has been deactivated. Contact the business owner.",
};

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
  const notice = reason ? REASONS[reason] : undefined;

  return (
    <AuthShell title="Sign in" intro="Use the email and password the owner set up for you.">
      {notice && (
        <p role="status" className="bg-warning-soft text-warning rounded-md px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      {!configured && (
        <div role="status" className="bg-warning-soft text-warning grid gap-1 rounded-md px-3 py-2 text-sm">
          <strong className="font-semibold">Sign-in isn&apos;t set up yet.</strong>
          <span>
            Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart the
            app. See docs/DEPLOYMENT.md.
          </span>
        </div>
      )}

      <LoginForm next={next} disabled={!configured} />
      <Link
        href="/forgot-password"
        className="text-muted-foreground hover:text-foreground -mt-2 w-fit text-sm underline"
      >
        Forgot your password?
      </Link>
    </AuthShell>
  );
}
