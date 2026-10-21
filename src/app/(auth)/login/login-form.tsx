"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { signIn, type SignInState } from "./actions";

export function LoginForm({ next, disabled }: { next?: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <form action={action} className="grid gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="email" label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={state.email}
          required
          disabled={disabled}
        />
      </Field>
      <Field id="password" label="Password">
        <Input name="password" type="password" autoComplete="current-password" required disabled={disabled} />
      </Field>
      {state.error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending || disabled} className="mt-1">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
