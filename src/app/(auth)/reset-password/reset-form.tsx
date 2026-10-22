"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { submitWithoutReset } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { setNewPassword, type ResetState } from "./actions";

export function ResetForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(setNewPassword, {});
  const e = state.errors ?? {};
  return (
    <form onSubmit={submitWithoutReset(action)} className="grid gap-4" noValidate>
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" defaultValue={email} hidden readOnly />
      <Field id="newPassword" label="New password" errors={e.newPassword} hint="At least 10 characters.">
        <Input name="newPassword" type="password" autoComplete="new-password" required />
      </Field>
      <Field id="confirmPassword" label="New password again" errors={e.confirmPassword}>
        <Input name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
