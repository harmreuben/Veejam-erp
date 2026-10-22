import { AuthShell } from "../_shell/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  return (
    <AuthShell
      title="Forgot your password?"
      intro="Enter your work email and we'll send you a link to choose a new one."
    >
      {expired && (
        <p role="status" className="bg-warning-soft text-warning rounded-md px-3 py-2 text-sm">
          That reset link has expired or was already used. Ask for a new one below.
        </p>
      )}
      <ForgotForm />
    </AuthShell>
  );
}
