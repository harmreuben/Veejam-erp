"use client";

import { Loader2 } from "lucide-react";
import * as React from "react";
import { startTransition, useActionState } from "react";

import { useResultToast } from "@/components/form-feedback";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/action-result";

export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/**
 * Submit handler that sends the form to a server action WITHOUT React's
 * automatic form reset. React 19 clears uncontrolled fields after a form
 * action finishes, even when the server rejected the input, which would wipe
 * everything the person typed. Submitting through onSubmit avoids that.
 */
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(formData));
  };
}

/** useActionState + toast + field errors + a submit handler that keeps the input on errors. */
export function useActionForm(action: FormAction) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, { ok: true });
  useResultToast(state);
  const errors = (name: string) => state.fieldErrors?.[name];
  const submit = React.useMemo(() => submitWithoutReset(formAction), [formAction]);
  return { state, formAction, submit, pending, errors };
}

export function SubmitBar({
  pending,
  label,
  pendingLabel,
  state,
  children,
}: {
  pending: boolean;
  label: string;
  pendingLabel?: string;
  state: ActionResult;
  children?: React.ReactNode;
}) {
  const message = state.ok ? null : (state.fieldErrors?.form?.join(" ") ?? state.message);
  return (
    <div className="flex flex-wrap items-center gap-3 border-t pt-5">
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? (pendingLabel ?? "Saving…") : label}
      </Button>
      {children}
      {message && (
        <p role="alert" className="text-destructive text-sm">
          {message}
        </p>
      )}
    </div>
  );
}

/** Two-column field grid used by every form. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid items-start gap-4 sm:grid-cols-2">{children}</div>;
}

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-4 border-t pt-5 md:grid-cols-[13rem_1fr] md:gap-8">
      <legend className="sr-only">{title}</legend>
      <div className="grid content-start gap-1">
        <p className="text-sm font-semibold" aria-hidden>
          {title}
        </p>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <FieldGrid>{children}</FieldGrid>
    </fieldset>
  );
}
