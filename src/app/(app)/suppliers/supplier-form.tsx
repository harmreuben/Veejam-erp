"use client";

import { selectClass } from "@/components/filters";
import { FormSection, SubmitBar, useActionForm, type FormAction } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKenyanPhone } from "@/lib/phone";

export type SupplierFormValues = {
  id?: string;
  version?: number;
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  kraPin: string | null;
  physicalAddress: string | null;
  paymentTermsDays: number;
  status: string;
  notes: string | null;
};

export const EMPTY_SUPPLIER: SupplierFormValues = {
  name: "",
  contactPerson: null,
  phone: null,
  email: null,
  kraPin: null,
  physicalAddress: null,
  paymentTermsDays: 0,
  status: "ACTIVE",
  notes: null,
};

export function SupplierForm({
  action,
  values,
  canEdit,
}: {
  action: FormAction;
  values: SupplierFormValues;
  canEdit: boolean;
}) {
  const { state, submit, pending, errors } = useActionForm(action);
  const ro = !canEdit;
  return (
    <form key={values.version ?? "new"} onSubmit={submit} className="grid gap-6" noValidate>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.version && <input type="hidden" name="version" value={values.version} />}
      <FormSection title="Supplier">
        <Field id="name" label="Business name" errors={errors("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={values.name} readOnly={ro} />
        </Field>
        <Field id="kraPin" label="KRA PIN" errors={errors("kraPin")}>
          <Input name="kraPin" defaultValue={values.kraPin ?? ""} readOnly={ro} autoCapitalize="characters" />
        </Field>
        <Field
          id="paymentTermsDays"
          label="Payment terms (days)"
          hint="Days VeeJam has to pay"
          errors={errors("paymentTermsDays")}
        >
          <Input
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={values.paymentTermsDays}
            readOnly={ro}
          />
        </Field>
        <Field id="status" label="Status" errors={errors("status")}>
          <select name="status" defaultValue={values.status} disabled={ro} className={selectClass}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      </FormSection>
      <FormSection title="Contact">
        <Field id="contactPerson" label="Contact person" errors={errors("contactPerson")}>
          <Input name="contactPerson" defaultValue={values.contactPerson ?? ""} readOnly={ro} />
        </Field>
        <Field id="phone" label="Phone" errors={errors("phone")}>
          <Input name="phone" type="tel" defaultValue={formatKenyanPhone(values.phone)} readOnly={ro} />
        </Field>
        <Field id="email" label="Email" errors={errors("email")}>
          <Input name="email" type="email" defaultValue={values.email ?? ""} readOnly={ro} />
        </Field>
        <Field id="physicalAddress" label="Physical address" errors={errors("physicalAddress")}>
          <Input name="physicalAddress" defaultValue={values.physicalAddress ?? ""} readOnly={ro} />
        </Field>
        <Field id="notes" label="Notes" errors={errors("notes")} className="sm:col-span-2">
          <Textarea name="notes" defaultValue={values.notes ?? ""} readOnly={ro} rows={3} />
        </Field>
      </FormSection>
      {canEdit && (
        <SubmitBar pending={pending} state={state} label={values.id ? "Save changes" : "Add supplier"} />
      )}
    </form>
  );
}
