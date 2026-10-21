"use client";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm, type FormAction } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { TBody, TD, TH, THead, Table } from "@/components/ui/table";

import { createPriceListAction, makeDefaultAction, savePricesAction, updatePriceListAction } from "./actions";

export function NewPriceListForm() {
  const { state, submit, pending, errors } = useActionForm(createPriceListAction);
  return (
    <form onSubmit={submit} className="bg-card grid gap-4 rounded-lg border p-5" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Field id="code" label="Code" hint="e.g. WHOLESALE" errors={errors("code")}>
          <Input name="code" autoCapitalize="characters" />
        </Field>
        <Field
          id="name"
          label="Name"
          hint="e.g. Wholesale prices"
          errors={errors("name")}
          className="sm:col-span-2"
        >
          <Input name="name" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="pricesIncludeTax" defaultChecked className="size-4" /> Prices include VAT
      </label>
      <SubmitBar pending={pending} state={state} label="Create price list" pendingLabel="Creating…" />
    </form>
  );
}

export function PriceListSettingsForm({
  list,
  isDefault,
}: {
  list: { id: string; name: string; pricesIncludeTax: boolean; status: string };
  isDefault: boolean;
}) {
  const { state, submit, pending, errors } = useActionForm(updatePriceListAction);
  const def = useActionForm(makeDefaultAction);
  return (
    <div className="bg-card grid gap-4 rounded-lg border p-5">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <input type="hidden" name="id" value={list.id} />
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field id="name" label="Name" errors={errors("name")} className="sm:col-span-2">
            <Input name="name" defaultValue={list.name} />
          </Field>
          <Field id="status" label="Status" errors={errors("status")}>
            <select name="status" defaultValue={list.status} className={selectClass}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="pricesIncludeTax"
            defaultChecked={list.pricesIncludeTax}
            className="size-4"
          />{" "}
          Prices include VAT
        </label>
        <SubmitBar pending={pending} state={state} label="Save settings" />
      </form>
      {!isDefault && list.status === "ACTIVE" && (
        <form onSubmit={def.submit}>
          <input type="hidden" name="id" value={list.id} />
          <Button type="submit" variant="outline" size="sm" disabled={def.pending}>
            Make this the default price list
          </Button>
        </form>
      )}
    </div>
  );
}

type GridRow = {
  id: string;
  sku: string;
  name: string;
  unitsPerPack: number;
  packsPerCarton: number;
  prices: Partial<Record<"PIECE" | "PACK" | "CARTON", string>>;
};

export function PriceGrid({ listId, rows, canEdit }: { listId: string; rows: GridRow[]; canEdit: boolean }) {
  const { state, submit, pending, errors } = useActionForm(savePricesAction as FormAction);
  const cellErrors = rows.flatMap((r) =>
    (["PIECE", "PACK", "CARTON"] as const).flatMap((u) =>
      (errors(`price:${r.id}:${u}`) ?? []).map((m) => `${r.name}, per ${u.toLowerCase()}: ${m}`),
    ),
  );
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={listId} />
      <Table minWidth={720}>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH numeric>Per piece</TH>
            <TH numeric>Per pack</TH>
            <TH numeric>Per carton</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <tr key={r.id}>
              <TD>
                <span className="font-medium">{r.name}</span>
                <div className="text-muted-foreground text-xs">
                  {r.sku} · {r.unitsPerPack} pcs/pk · {r.packsPerCarton} pk/ctn
                </div>
              </TD>
              {(["PIECE", "PACK", "CARTON"] as const).map((u) => (
                <TD key={u} numeric>
                  <Input
                    name={`price:${r.id}:${u}`}
                    defaultValue={r.prices[u] ?? ""}
                    inputMode="decimal"
                    aria-label={`${r.name} price per ${u.toLowerCase()}`}
                    aria-invalid={errors(`price:${r.id}:${u}`) ? true : undefined}
                    readOnly={!canEdit}
                    className="ml-auto w-28 text-right tabular-nums"
                    placeholder="—"
                  />
                </TD>
              ))}
            </tr>
          ))}
        </TBody>
      </Table>
      {cellErrors.length > 0 && (
        <ul role="alert" className="text-destructive list-disc pl-5 text-sm">
          {cellErrors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {canEdit && (
        <SubmitBar pending={pending} state={state} label="Save prices">
          <span className="text-muted-foreground text-sm">Blank = not sold in that unit on this list.</span>
        </SubmitBar>
      )}
    </form>
  );
}
