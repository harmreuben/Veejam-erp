"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import { useResultToast } from "@/components/form-feedback";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { UserRole } from "@/generated/prisma/enums";
import type { ActionResult } from "@/server/action-result";

import { addStaff } from "./actions";

export function AddStaffForm({
  roles,
}: {
  roles: { value: UserRole; label: string; description: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addStaff, { ok: true });
  useResultToast(state);
  const formRef = useRef<HTMLFormElement>(null);
  const e = state.fieldErrors ?? {};
  const [role, setRole] = useState<UserRole>("SALES");
  const description = roles.find((r) => r.value === role)?.description;

  // After a successful add, clear the form. The form's reset event also resets the role.
  useEffect(() => {
    if (state.ok && state.at) formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={action}
      onReset={() => setRole("SALES")}
      className="grid items-start gap-4 sm:grid-cols-2"
      noValidate
    >
      <Field id="new-fullName" label="Full name" errors={e.fullName}>
        <Input name="fullName" autoComplete="off" required />
      </Field>
      <Field id="new-email" label="Email" hint="Used to sign in. No email is sent." errors={e.email}>
        <Input name="email" type="email" autoComplete="off" required />
      </Field>
      <Field id="new-role" label="Role" hint={description} errors={e.role}>
        <select
          name="role"
          value={role}
          onChange={(ev) => setRole(ev.target.value as UserRole)}
          className="border-input bg-card focus-visible:ring-ring/40 h-9 w-full min-w-0 rounded-md border px-2 text-sm outline-none focus-visible:ring-[3px]"
        >
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="new-password"
        label="Temporary password"
        hint="At least 10 characters. Give it to them in person; they change it after signing in."
        errors={e.temporaryPassword}
      >
        <Input name="temporaryPassword" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? "Adding…" : "Add user"}
        </Button>
        {!state.ok && state.message && !Object.keys(e).length && (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
