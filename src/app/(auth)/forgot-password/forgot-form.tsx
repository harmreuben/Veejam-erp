"use client";

import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { useActionState } from "react";

import { submitWithoutReset } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { askForResetLink, type ForgotState } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(askForResetLink, {});

  if (state.sentTo) {
    return (
      <div role="status" className="bg-success-soft grid gap-2 rounded-md p-4 text-sm">
        <MailCheck className="text-success size-5" aria-hidden />
        <p>
          If <strong>{state.sentTo}</strong> has an account, a reset link is on its way. It works once, for
          one hour.
        </p>
        <p className="text-muted-foreground">
          Nothing after a few minutes? Check the spam folder, or ask the owner to send you a new link.
        </p>
        <Link href="/login" className="w-fit underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submitWithoutReset(action)} className="grid gap-4" noValidate>
      <Field id="email" label="Email">
        <Input name="email" type="email" autoComplete="username" defaultValue={state.email} required />
      </Field>
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Sending…" : "Email me a reset link"}
      </Button>
      <Link href="/login" className="text-muted-foreground hover:text-foreground w-fit text-sm underline">
        Back to sign in
      </Link>
    </form>
  );
}
