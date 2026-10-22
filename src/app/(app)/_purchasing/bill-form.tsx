"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, toDecimal } from "@/lib/money";

import { postBillAction } from "./actions";

type Receipt = {
  id: string;
  number: string;
  receivedOn: string;
  supplierReference: string | null;
  cost: string;
  expectedTax: string;
};
type Expense = { key: number; accountId: string; description: string; net: string; tax: string };

const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());
const dec = (v: string) => (isMoney(v) ? toDecimal(v.replace(/,/g, "").trim()) : toDecimal(0));
let k = 1;
const blank = (): Expense => ({ key: k++, accountId: "", description: "", net: "", tax: "" });

export function BillForm({
  idempotencyKey,
  today,
  suppliers,
  supplierId,
  receipts,
  preselect,
  accounts,
}: {
  idempotencyKey: string;
  today: string;
  suppliers: { id: string; name: string; paymentTermsDays: number }[];
  supplierId: string | null;
  receipts: Receipt[];
  preselect: string | null;
  accounts: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const { state, submit, pending, errors } = useActionForm(postBillAction);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const [picked, setPicked] = useState<Record<string, { on: boolean; net: string; tax: string }>>(() =>
    Object.fromEntries(
      receipts.map((r) => [
        r.id,
        { on: preselect ? r.id === preselect : receipts.length === 1, net: r.cost, tax: r.expectedTax },
      ]),
    ),
  );
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const updateExp = (key: number, patch: Partial<Expense>) =>
    setExpenses((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  const goods = receipts.filter((r) => picked[r.id]?.on);
  const subtotal = goods
    .reduce((s, r) => s.plus(dec(picked[r.id]!.net)), toDecimal(0))
    .plus(expenses.reduce((s, e) => s.plus(dec(e.net)), toDecimal(0)));
  const tax = goods
    .reduce((s, r) => s.plus(dec(picked[r.id]!.tax)), toDecimal(0))
    .plus(expenses.reduce((s, e) => s.plus(dec(e.tax)), toDecimal(0)));
  const diff = goods.reduce((s, r) => s.plus(dec(picked[r.id]!.net)).minus(r.cost), toDecimal(0));

  return (
    <div className="grid gap-6">
      <Field id="supplier" label="Supplier">
        <select
          value={supplierId ?? ""}
          onChange={(e) => router.push(`/supplier-bills/new?supplier=${e.target.value}`)}
          className={selectClass}
        >
          <option value="">Choose a supplier…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {supplier && (
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <input type="hidden" name="supplierId" value={supplier.id} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <div className="grid items-start gap-4 sm:grid-cols-3">
            <Field
              id="supplierInvoiceNumber"
              label="Supplier's invoice number"
              errors={errors("supplierInvoiceNumber")}
            >
              <Input name="supplierInvoiceNumber" autoCapitalize="characters" />
            </Field>
            <Field id="billDate" label="Invoice date" errors={errors("billDate")}>
              <Input name="billDate" type="date" defaultValue={today} max={today} />
            </Field>
            <Field
              id="dueDate"
              label="Due date"
              hint={
                supplier.paymentTermsDays
                  ? `Blank: ${supplier.paymentTermsDays} days after the invoice date`
                  : "Blank: due on the invoice date"
              }
              errors={errors("dueDate")}
            >
              <Input name="dueDate" type="date" />
            </Field>
          </div>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-semibold">Goods received on this invoice</legend>
            {receipts.length === 0 && (
              <p className="text-muted-foreground text-sm">
                Nothing from {supplier.name} is waiting for a bill.
              </p>
            )}
            {receipts.map((r, i) => {
              const p = picked[r.id]!;
              const rowDiff = dec(p.net).minus(r.cost);
              return (
                <div
                  key={r.id}
                  className="bg-card grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_10rem_9rem] sm:items-end"
                >
                  <input type="hidden" name={`receipts.${i}.goodsReceiptId`} value={r.id} />
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      name={`receipts.${i}.include`}
                      checked={p.on}
                      onChange={(e) => setPicked((x) => ({ ...x, [r.id]: { ...p, on: e.target.checked } }))}
                      className="mt-1"
                    />
                    <span className="text-sm">
                      <strong>{r.number}</strong> · {r.receivedOn}
                      {r.supplierReference && (
                        <span className="text-muted-foreground"> · {r.supplierReference}</span>
                      )}
                      <span className="text-muted-foreground block text-xs">
                        At cost when received: {formatKES(r.cost)}
                      </span>
                      {p.on && !rowDiff.isZero() && (
                        <span className="text-warning block text-xs">
                          {formatKES(rowDiff.abs().toFixed(2))} {rowDiff.isNegative() ? "below" : "above"} the
                          cost on receipt
                        </span>
                      )}
                    </span>
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">Amount excl. VAT</span>
                    <Input
                      name={`receipts.${i}.net`}
                      inputMode="decimal"
                      value={p.net}
                      disabled={!p.on}
                      onChange={(e) => setPicked((x) => ({ ...x, [r.id]: { ...p, net: e.target.value } }))}
                      aria-label={`${r.number} amount excluding VAT`}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    <span className="text-muted-foreground">VAT</span>
                    <Input
                      name={`receipts.${i}.tax`}
                      inputMode="decimal"
                      value={p.tax}
                      disabled={!p.on}
                      onChange={(e) => setPicked((x) => ({ ...x, [r.id]: { ...p, tax: e.target.value } }))}
                      aria-label={`${r.number} VAT`}
                    />
                  </label>
                  {["net", "tax"].flatMap((f) => errors(`receipts.${i}.${f}`) ?? []).length > 0 && (
                    <p className="text-destructive text-xs sm:col-span-3">
                      {["net", "tax"].flatMap((f) => errors(`receipts.${i}.${f}`) ?? []).join(" ")}
                    </p>
                  )}
                </div>
              );
            })}
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-semibold">Other charges on this invoice</legend>
            {expenses.map((e, i) => (
              <div
                key={e.key}
                className="grid grid-cols-2 gap-2 md:grid-cols-[14rem_minmax(0,1fr)_8rem_7rem_2.5rem] md:items-center"
              >
                <select
                  name={`expenses.${i}.accountId`}
                  value={e.accountId}
                  onChange={(ev) => updateExp(e.key, { accountId: ev.target.value })}
                  aria-label={`Charge ${i + 1} account`}
                  className={selectClass}
                >
                  <option value="">Account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </select>
                <Input
                  name={`expenses.${i}.description`}
                  placeholder="e.g. Delivery"
                  value={e.description}
                  onChange={(ev) => updateExp(e.key, { description: ev.target.value })}
                  aria-label={`Charge ${i + 1} description`}
                />
                <Input
                  name={`expenses.${i}.net`}
                  inputMode="decimal"
                  placeholder="Excl. VAT"
                  value={e.net}
                  onChange={(ev) => updateExp(e.key, { net: ev.target.value })}
                  aria-label={`Charge ${i + 1} amount excluding VAT`}
                />
                <Input
                  name={`expenses.${i}.tax`}
                  inputMode="decimal"
                  placeholder="VAT"
                  value={e.tax}
                  onChange={(ev) => updateExp(e.key, { tax: ev.target.value })}
                  aria-label={`Charge ${i + 1} VAT`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setExpenses((es) => es.filter((x) => x.key !== e.key))}
                  aria-label={`Remove charge ${i + 1}`}
                >
                  <Trash2 aria-hidden />
                </Button>
                {["accountId", "description", "net", "tax"].flatMap((f) => errors(`expenses.${i}.${f}`) ?? [])
                  .length > 0 && (
                  <p className="text-destructive col-span-2 text-xs md:col-span-5">
                    {["accountId", "description", "net", "tax"]
                      .flatMap((f) => errors(`expenses.${i}.${f}`) ?? [])
                      .join(" ")}
                  </p>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setExpenses((es) => [...es, blank()])}
            >
              <Plus aria-hidden /> Add a charge (transport, services…)
            </Button>
          </fieldset>

          <Field id="notes" label="Notes" errors={errors("notes")}>
            <Textarea name="notes" rows={2} />
          </Field>

          {errors("form")?.map((m) => (
            <p key={m} role="alert" className="text-destructive text-sm">
              {m}
            </p>
          ))}
          <dl className="ml-auto grid w-full max-w-sm grid-cols-2 gap-1 text-sm" aria-live="polite">
            <dt className="text-muted-foreground">Excluding VAT</dt>
            <dd className="text-right tabular-nums">{formatKES(subtotal.toFixed(2))}</dd>
            <dt className="text-muted-foreground">VAT</dt>
            <dd className="text-right tabular-nums">{formatKES(tax.toFixed(2))}</dd>
            <dt className="font-semibold">Bill total</dt>
            <dd className="text-right font-semibold tabular-nums">
              {formatKES(subtotal.plus(tax).toFixed(2))}
            </dd>
            {!diff.isZero() && (
              <>
                <dt className="text-muted-foreground col-span-2 text-xs">
                  Goods billed {formatKES(diff.abs().toFixed(2))} {diff.isNegative() ? "below" : "above"}{" "}
                  their cost on receipt; the difference goes to Purchase price differences.
                </dt>
              </>
            )}
          </dl>
          <SubmitBar pending={pending} state={state} label="Enter bill" pendingLabel="Saving…">
            <span className="text-muted-foreground text-sm">
              Money already paid to {supplier.name} in advance is applied to it.
            </span>
          </SubmitBar>
        </form>
      )}
    </div>
  );
}
