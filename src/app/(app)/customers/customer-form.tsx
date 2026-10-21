"use client";

import { selectClass } from "@/components/filters";
import { FormSection, SubmitBar, useActionForm, type FormAction } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKenyanPhone } from "@/lib/phone";

export type CustomerFormValues = {
  id?: string;
  version?: number;
  name: string;
  type: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  kraPin: string | null;
  physicalAddress: string | null;
  town: string | null;
  creditLimit: string;
  paymentTermsDays: number;
  priceListId: string | null;
  status: string;
  notes: string | null;
};

export const EMPTY_CUSTOMER: CustomerFormValues = {
  name: "",
  type: "RETAIL_SHOP",
  contactPerson: null,
  phone: null,
  email: null,
  kraPin: null,
  physicalAddress: null,
  town: null,
  creditLimit: "0.00",
  paymentTermsDays: 0,
  priceListId: null,
  status: "ACTIVE",
  notes: null,
};

export function CustomerForm({
  action,
  values,
  types,
  priceLists,
  canCredit,
  canEdit,
  isNew,
}: {
  action: FormAction;
  values: CustomerFormValues;
  types: { value: string; label: string }[];
  priceLists: { id: string; label: string }[];
  canCredit: boolean;
  canEdit: boolean;
  isNew: boolean;
}) {
  const { state, submit, pending, errors } = useActionForm(action);
  const ro = !canEdit;
  const showDuplicateBox = isNew && (errors("name")?.some((m) => m.includes("already exists")) ?? false);

  return (
    <form key={values.version ?? "new"} onSubmit={submit} className="grid gap-6" noValidate>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.version && <input type="hidden" name="version" value={values.version} />}

      <FormSection title="Business" description="How the customer appears on invoices and statements.">
        <Field id="name" label="Business name" errors={errors("name")} className="sm:col-span-2">
          <Input name="name" defaultValue={values.name} readOnly={ro} required />
        </Field>
        {showDuplicateBox && (
          <label className="bg-warning-soft text-warning flex items-start gap-2 rounded-md px-3 py-2 text-sm sm:col-span-2">
            <input type="checkbox" name="allowDuplicateName" className="mt-0.5 size-4" />
            This is a different customer with the same name
          </label>
        )}
        <Field id="type" label="Type" errors={errors("type")}>
          <select name="type" defaultValue={values.type} disabled={ro} className={selectClass}>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="kraPin"
          label="KRA PIN"
          hint="Needed for tax invoices to VAT-registered customers"
          errors={errors("kraPin")}
        >
          <Input name="kraPin" defaultValue={values.kraPin ?? ""} readOnly={ro} autoCapitalize="characters" />
        </Field>
        <Field id="status" label="Status" errors={errors("status")}>
          <select name="status" defaultValue={values.status} disabled={ro} className={selectClass}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive (can&apos;t be sold to)</option>
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Contact"
        description="A real number lets the customer be matched to M-Pesa and WhatsApp later."
      >
        <Field id="contactPerson" label="Contact person" errors={errors("contactPerson")}>
          <Input name="contactPerson" defaultValue={values.contactPerson ?? ""} readOnly={ro} />
        </Field>
        <Field id="phone" label="Phone" hint="e.g. 0712 345 678" errors={errors("phone")}>
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={formatKenyanPhone(values.phone)}
            readOnly={ro}
          />
        </Field>
        <Field id="email" label="Email" errors={errors("email")}>
          <Input name="email" type="email" defaultValue={values.email ?? ""} readOnly={ro} />
        </Field>
        <Field id="town" label="Town / area" errors={errors("town")}>
          <Input name="town" defaultValue={values.town ?? ""} readOnly={ro} />
        </Field>
        <Field
          id="physicalAddress"
          label="Physical address"
          errors={errors("physicalAddress")}
          className="sm:col-span-2"
        >
          <Input name="physicalAddress" defaultValue={values.physicalAddress ?? ""} readOnly={ro} />
        </Field>
      </FormSection>

      <FormSection
        title="Credit and pricing"
        description={
          canCredit
            ? "Credit limit 0 means cash only. Limits are enforced on orders and invoices from Phase 4."
            : "Only an owner, administrator or accountant can change credit."
        }
      >
        <Field id="creditLimit" label="Credit limit (KES)" errors={errors("creditLimit")}>
          <Input
            name="creditLimit"
            inputMode="decimal"
            defaultValue={values.creditLimit}
            readOnly={ro || !canCredit}
          />
        </Field>
        <Field
          id="paymentTermsDays"
          label="Payment terms (days)"
          hint="0 = pay on delivery"
          errors={errors("paymentTermsDays")}
        >
          <Input
            name="paymentTermsDays"
            type="number"
            min={0}
            max={365}
            defaultValue={values.paymentTermsDays}
            readOnly={ro || !canCredit}
          />
        </Field>
        <Field
          id="priceListId"
          label="Price list"
          hint="Blank uses the default price list"
          errors={errors("priceListId")}
        >
          <select
            name="priceListId"
            defaultValue={values.priceListId ?? ""}
            disabled={ro}
            className={selectClass}
          >
            <option value="">Default price list</option>
            {priceLists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Notes">
        <Field id="notes" label="Notes" errors={errors("notes")} className="sm:col-span-2">
          <Textarea name="notes" defaultValue={values.notes ?? ""} readOnly={ro} rows={3} />
        </Field>
      </FormSection>

      {canEdit && (
        <SubmitBar pending={pending} state={state} label={isNew ? "Add customer" : "Save changes"} />
      )}
    </form>
  );
}
