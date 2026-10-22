import Link from "next/link";

import { currentSessionId, hasRecoveryProof } from "@/server/auth/password-reset";
import { createSupabaseServerClient } from "@/server/auth/supabase";

import { AuthShell } from "../_shell/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Choose a new password" };

/** Reached only from a reset link (the link signs the person in and leaves a 15-minute proof). */
export default async function ResetPasswordPage() {
  const ok = await hasRecoveryProof(await currentSessionId());
  const email = ok
    ? String((await (await createSupabaseServerClient()).auth.getClaims()).data?.claims?.email ?? "")
    : "";
  return (
    <AuthShell
      title="Choose a new password"
      intro={ok ? `For ${email}.` : "This page opens from a reset link."}
    >
      {ok ? (
        <ResetForm email={email} />
      ) : (
        <p role="status" className="bg-warning-soft text-warning grid gap-2 rounded-md px-3 py-2 text-sm">
          This reset has expired or wasn&apos;t started from a reset link.
          <Link href="/forgot-password" className="w-fit underline">
            Ask for a new link
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
