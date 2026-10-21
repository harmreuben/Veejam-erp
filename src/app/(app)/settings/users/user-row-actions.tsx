"use client";

import { useActionState, useRef } from "react";
import { Loader2 } from "lucide-react";

import { useResultToast } from "@/components/form-feedback";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/generated/prisma/enums";
import type { ActionResult } from "@/server/action-result";

import { updateAccess, updateRole } from "./actions";

const selectClass =
  "border-input bg-card h-8 rounded-md border px-2 text-sm focus-visible:ring-ring/40 focus-visible:ring-[3px] outline-none";

export function RoleSelect({
  userId,
  name,
  role,
  roles,
}: {
  userId: string;
  name: string;
  role: UserRole;
  roles: { value: UserRole; label: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateRole, { ok: true });
  useResultToast(state);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        defaultValue={role}
        aria-label={`Role for ${name}`}
        className={selectClass}
        disabled={pending}
        onChange={() => formRef.current?.requestSubmit()}
      >
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      {pending && <Loader2 className="text-muted-foreground size-4 animate-spin" aria-label="Saving" />}
    </form>
  );
}

export function AccessToggle({ userId, name, active }: { userId: string; name: string; active: boolean }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(updateAccess, { ok: true });
  useResultToast(state);
  const formRef = useRef<HTMLFormElement>(null);

  if (!active) {
    return (
      <form action={action}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value="true" />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Reactivate
        </Button>
      </form>
    );
  }

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value="false" />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={pending}>
            Deactivate
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Deactivate {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They will be signed out on their next click and can&apos;t sign in again until reactivated. Their
            past work stays in the records.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep access</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => formRef.current?.requestSubmit()}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
