"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

import { useResultToast } from "@/components/form-feedback";
import { submitWithoutReset } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/server/action-result";

import { changePassword } from "./actions";

export function ChangePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(changePassword, { ok: true });
  useResultToast(state);
  const ref = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  useEffect(() => {
    if (state.ok && state.at) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} onSubmit={submitWithoutReset(action)} className="grid max-w-sm gap-4" noValidate>
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <Field id="currentPassword" label="Current password" errors={e.currentPassword}>
        <Input name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field id="newPassword" label="New password" hint="At least 10 characters." errors={e.newPassword}>
        <Input name="newPassword" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field id="confirmPassword" label="Repeat new password" errors={e.confirmPassword}>
        <Input name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
