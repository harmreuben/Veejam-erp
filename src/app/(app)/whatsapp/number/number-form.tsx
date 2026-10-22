"use client";

import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { linkNumberAction } from "../actions";

export function NumberForm({ current }: { current: string | null }) {
  const { state, submit, pending, errors } = useActionForm(linkNumberAction);
  return (
    <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
      <Field
        id="whatsappNumber"
        label="Your WhatsApp number"
        hint="Kenyan numbers can be typed as 0712 345 678. Leave blank to unlink."
        errors={errors("whatsappNumber")}
      >
        <Input name="whatsappNumber" inputMode="tel" defaultValue={current ?? ""} />
      </Field>
      <SubmitBar pending={pending} state={state} label="Save number" />
    </form>
  );
}
