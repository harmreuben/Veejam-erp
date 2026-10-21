"use client";

import { useState } from "react";

import { selectClass } from "@/components/filters";
import { FormSection, SubmitBar, useActionForm, type FormAction } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { describePackSizes } from "@/lib/units";

export type ProductFormValues = {
  id?: string;
  version?: number;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string;
  category: string;
  unitsPerPack: number | "";
  packsPerCarton: number | "";
  costPrice: string | null;
  taxCategory: string;
  reorderLevel: number;
  status: string;
  notes: string | null;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  sku: "",
  barcode: null,
  name: "",
  brand: "",
  category: "",
  unitsPerPack: "",
  packsPerCarton: "",
  costPrice: null,
  taxCategory: "STANDARD",
  reorderLevel: 0,
  status: "ACTIVE",
  notes: null,
};

export function ProductForm({
  action,
  values,
  canEdit,
  canSeeCost,
  withPrices,
  hasStock,
}: {
  action: FormAction;
  values: ProductFormValues;
  canEdit: boolean;
  canSeeCost: boolean;
  /** Show default-list price fields (new products, for roles that may set prices). */
  withPrices: boolean;
  hasStock?: boolean;
}) {
  const { state, submit, pending, errors } = useActionForm(action);
  const [perPack, setPerPack] = useState(String(values.unitsPerPack));
  const [perCarton, setPerCarton] = useState(String(values.packsPerCarton));
  const sizes = { unitsPerPack: Number(perPack), packsPerCarton: Number(perCarton) };
  const sizesValid =
    Number.isInteger(sizes.unitsPerPack) &&
    sizes.unitsPerPack >= 1 &&
    Number.isInteger(sizes.packsPerCarton) &&
    sizes.packsPerCarton >= 1;
  const ro = !canEdit;

  return (
    <form key={values.version ?? "new"} onSubmit={submit} className="grid gap-6" noValidate>
      {values.id && <input type="hidden" name="id" value={values.id} />}
      {values.version && <input type="hidden" name="version" value={values.version} />}

      <FormSection title="Product" description="One record per sellable item (SKU).">
        <Field
          id="sku"
          label="SKU code"
          hint="e.g. WRG-001. Letters, digits and dashes."
          errors={errors("sku")}
        >
          <Input name="sku" defaultValue={values.sku} readOnly={ro} autoCapitalize="characters" required />
        </Field>
        <Field id="barcode" label="Barcode" hint="Optional, digits only" errors={errors("barcode")}>
          <Input name="barcode" inputMode="numeric" defaultValue={values.barcode ?? ""} readOnly={ro} />
        </Field>
        <Field
          id="name"
          label="Name"
          hint="As it should appear on invoices"
          errors={errors("name")}
          className="sm:col-span-2"
        >
          <Input name="name" defaultValue={values.name} readOnly={ro} required />
        </Field>
        <Field id="brand" label="Brand" errors={errors("brand")}>
          <Input name="brand" defaultValue={values.brand} readOnly={ro} required />
        </Field>
        <Field id="category" label="Category" errors={errors("category")}>
          <Input name="category" defaultValue={values.category} readOnly={ro} required />
        </Field>
        <Field id="status" label="Status" errors={errors("status")}>
          <select name="status" defaultValue={values.status} disabled={ro} className={selectClass}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive (hidden from new documents)</option>
          </select>
        </Field>
        <Field
          id="taxCategory"
          label="Tax category"
          hint="Rates are set in Phase 5"
          errors={errors("taxCategory")}
        >
          <select name="taxCategory" defaultValue={values.taxCategory} disabled={ro} className={selectClass}>
            <option value="STANDARD">Standard rate</option>
            <option value="ZERO_RATED">Zero-rated</option>
            <option value="EXEMPT">Exempt</option>
          </select>
        </Field>
      </FormSection>

      <FormSection
        title="Pack sizes"
        description="Stock is kept in pieces. These decide what a pack and a carton mean. Check them against a real carton."
      >
        <Field id="unitsPerPack" label="Pieces per pack" errors={errors("unitsPerPack")}>
          <Input
            name="unitsPerPack"
            type="number"
            min={1}
            value={perPack}
            onChange={(e) => setPerPack(e.target.value)}
            readOnly={ro}
            required
          />
        </Field>
        <Field id="packsPerCarton" label="Packs per carton" errors={errors("packsPerCarton")}>
          <Input
            name="packsPerCarton"
            type="number"
            min={1}
            value={perCarton}
            onChange={(e) => setPerCarton(e.target.value)}
            readOnly={ro}
            required
          />
        </Field>
        <p className="text-muted-foreground text-sm sm:col-span-2" aria-live="polite">
          {sizesValid ? `${describePackSizes(sizes)}.` : "Enter both pack sizes to see the conversion."}
          {hasStock &&
            " Changing pack sizes doesn't change stock in pieces, but it changes what pack and carton prices mean."}
        </p>
        <Field
          id="reorderLevel"
          label="Reorder level (pieces)"
          hint="Flag as low stock at or below this total"
          errors={errors("reorderLevel")}
        >
          <Input name="reorderLevel" type="number" min={0} defaultValue={values.reorderLevel} readOnly={ro} />
        </Field>
        {canSeeCost && (
          <Field
            id="costPrice"
            label="Cost per piece (KES, excl. VAT)"
            hint="Blank if not known yet"
            errors={errors("costPrice")}
          >
            <Input name="costPrice" inputMode="decimal" defaultValue={values.costPrice ?? ""} readOnly={ro} />
          </Field>
        )}
      </FormSection>

      {withPrices && (
        <FormSection
          title="Selling prices"
          description="Prices on the default price list. Leave a unit blank if it isn't sold that way. Edit later under Price lists."
        >
          {(["PIECE", "PACK", "CARTON"] as const).map((u) => (
            <Field
              key={u}
              id={`prices.${u}`}
              label={`Price per ${u.toLowerCase()} (KES)`}
              errors={errors(`prices.${u}`)}
            >
              <Input name={`prices.${u}`} inputMode="decimal" />
            </Field>
          ))}
        </FormSection>
      )}

      <FormSection title="Notes">
        <Field id="notes" label="Notes" errors={errors("notes")} className="sm:col-span-2">
          <Textarea name="notes" defaultValue={values.notes ?? ""} readOnly={ro} rows={3} />
        </Field>
      </FormSection>

      {canEdit && (
        <SubmitBar pending={pending} state={state} label={values.id ? "Save changes" : "Add product"} />
      )}
    </form>
  );
}
