"use client";

import { Loader2 } from "lucide-react";

import { useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { taxRateAction } from "../../_sales/actions";

export function TaxRateForm({
  category,
  name,
  rate,
  canEdit,
}: {
  category: string;
  name: string;
  rate: string;
  canEdit: boolean;
}) {
  const { submit, pending, errors, state } = useActionForm(taxRateAction);
  return (
    <form onSubmit={submit} className="grid items-end gap-3 sm:grid-cols-[1fr_8rem_auto]" noValidate>
      <input type="hidden" name="category" value={category} />
      <Field id={`${category}-name`} label="Name on documents" errors={errors("name")}>
        <Input name="name" defaultValue={name} readOnly={!canEdit} />
      </Field>
      <Field id={`${category}-rate`} label="Rate (%)" errors={errors("rate")}>
        <Input name="rate" inputMode="decimal" defaultValue={rate} readOnly={!canEdit} />
      </Field>
      {canEdit && (
        <Button type="submit" variant="outline" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Save
        </Button>
      )}
      {!state.ok && !state.fieldErrors && state.message && (
        <p role="alert" className="text-destructive text-sm sm:col-span-3">
          {state.message}
        </p>
      )}
    </form>
  );
}
