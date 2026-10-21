"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { useResultToast } from "@/components/form-feedback";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/server/action-result";

import { saveCompanySettings } from "./actions";

export type CompanySettingsFormValues = {
  name: string;
  telephone: string;
  documentEmail: string;
  country: string;
  currency: string;
  timezone: string;
  businessType: string;
  productScope: string;
  kraPin: string | null;
  physicalAddress: string | null;
  postalAddress: string | null;
  paymentInstructions: string | null;
  invoiceTerms: string | null;
  defaultPaymentTermsDays: number;
  version: number;
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-5 border-t pt-6 md:grid-cols-[14rem_1fr] md:gap-10">
      <legend className="sr-only">{title}</legend>
      <div className="grid content-start gap-1">
        <h2 className="text-sm font-semibold" aria-hidden>
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function CompanySettingsForm({
  values,
  canEdit,
}: {
  values: CompanySettingsFormValues;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveCompanySettings, { ok: true });
  useResultToast(state);
  const e = state.fieldErrors ?? {};
  const ro = !canEdit;

  return (
    // key on version: after a save the server sends a new version and the form resets to the saved values
    <form key={values.version} action={action} className="grid gap-8" noValidate>
      <input type="hidden" name="version" value={values.version} />

      <Section title="Business" description="Shown at the top of invoices, receipts and statements.">
        <Field id="name" label="Company name" errors={e.name} className="sm:col-span-2">
          <Input name="name" defaultValue={values.name} readOnly={ro} required />
        </Field>
        <Field
          id="kraPin"
          label="KRA PIN"
          hint="Printed on tax invoices. Example: P051234567X"
          errors={e.kraPin}
        >
          <Input name="kraPin" defaultValue={values.kraPin ?? ""} readOnly={ro} autoCapitalize="characters" />
        </Field>
        <Field id="businessType" label="Business type" errors={e.businessType}>
          <Input name="businessType" defaultValue={values.businessType} readOnly={ro} />
        </Field>
        <Field id="productScope" label="Products sold" errors={e.productScope} className="sm:col-span-2">
          <Input name="productScope" defaultValue={values.productScope} readOnly={ro} />
        </Field>
      </Section>

      <Section
        title="Contact"
        description="How customers reach VeeJam. The email is printed on documents only; the system never sends email."
      >
        <Field id="telephone" label="Telephone" errors={e.telephone}>
          <Input name="telephone" type="tel" defaultValue={values.telephone} readOnly={ro} />
        </Field>
        <Field id="documentEmail" label="Email on documents" errors={e.documentEmail}>
          <Input name="documentEmail" type="email" defaultValue={values.documentEmail} readOnly={ro} />
        </Field>
        <Field id="physicalAddress" label="Physical address" errors={e.physicalAddress}>
          <Input name="physicalAddress" defaultValue={values.physicalAddress ?? ""} readOnly={ro} />
        </Field>
        <Field id="postalAddress" label="Postal address" errors={e.postalAddress}>
          <Input name="postalAddress" defaultValue={values.postalAddress ?? ""} readOnly={ro} />
        </Field>
      </Section>

      <Section title="Region" description="Currency and time zone used for all amounts and dates.">
        <Field id="country" label="Country" errors={e.country}>
          <Input name="country" defaultValue={values.country} readOnly={ro} />
        </Field>
        <Field id="currency" label="Currency" errors={e.currency}>
          <Input name="currency" defaultValue={values.currency} readOnly={ro} maxLength={3} />
        </Field>
        <Field id="timezone" label="Time zone" errors={e.timezone}>
          <Input name="timezone" defaultValue={values.timezone} readOnly={ro} />
        </Field>
      </Section>

      <Section title="Invoices" description="Default terms and the payment details printed on every invoice.">
        <Field
          id="defaultPaymentTermsDays"
          label="Payment terms (days)"
          hint="0 means due on the invoice date."
          errors={e.defaultPaymentTermsDays}
        >
          <Input
            name="defaultPaymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            defaultValue={values.defaultPaymentTermsDays}
            readOnly={ro}
          />
        </Field>
        <div className="hidden sm:block" />
        <Field
          id="paymentInstructions"
          label="Payment instructions"
          hint="For example the M-Pesa paybill or till number and bank details."
          errors={e.paymentInstructions}
          className="sm:col-span-2"
        >
          <Textarea
            name="paymentInstructions"
            defaultValue={values.paymentInstructions ?? ""}
            readOnly={ro}
            rows={3}
          />
        </Field>
        <Field id="invoiceTerms" label="Invoice terms" errors={e.invoiceTerms} className="sm:col-span-2">
          <Textarea name="invoiceTerms" defaultValue={values.invoiceTerms ?? ""} readOnly={ro} rows={4} />
        </Field>
      </Section>

      {canEdit && (
        <div className="flex items-center gap-3 border-t pt-6">
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {!state.ok && state.message && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
