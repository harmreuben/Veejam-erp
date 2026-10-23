"use client";

import { useState } from "react";

import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, toDecimal } from "@/lib/money";
import { calculateLine } from "@/lib/sales-math";
import { UNIT_LABELS, type Unit } from "@/lib/units";

import { correctCreditNoteAction, creditNoteAction } from "../../../payments/actions";

type Line = {
  id: string;
  sku: string;
  description: string;
  unit: Unit;
  quantity: number;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
  remaining: number;
  /** Editing: the quantity on the credit note being corrected. */
  current?: number;
};

/** Editing an issued credit note (owners and admins): it's replaced by a corrected one. */
type Correcting = {
  creditNoteId: string;
  number: string;
  version: number;
  reason: string;
  returnsToStock: boolean;
};

export function CreditNoteForm({
  invoiceId,
  idempotencyKey,
  lines,
  pricesIncludeTax,
  outstanding,
  correcting,
}: {
  invoiceId: string;
  idempotencyKey: string;
  lines: Line[];
  pricesIncludeTax: boolean;
  outstanding: string;
  correcting?: Correcting;
}) {
  const { state, submit, pending, errors } = useActionForm(
    correcting ? correctCreditNoteAction : creditNoteAction,
  );
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.filter((l) => l.current).map((l) => [l.id, String(l.current)])),
  );
  const total = lines.reduce((s, l) => {
    const q = Number(qty[l.id] ?? "0");
    if (!Number.isInteger(q) || q <= 0 || q > l.remaining) return s;
    const t = calculateLine(
      { quantity: q, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxRate: l.taxRate },
      pricesIncludeTax,
    );
    return s.plus(t.grossAmount);
  }, toDecimal(0));
  const toInvoice = total.lessThan(outstanding) ? total : toDecimal(outstanding);
  const toCredit = total.minus(toInvoice);

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {correcting && (
        <>
          <input type="hidden" name="creditNoteId" value={correcting.creditNoteId} />
          <input type="hidden" name="version" value={correcting.version} />
        </>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Invoiced</th>
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">
                  <div className="font-medium">{l.description}</div>
                  <div className="text-muted-foreground text-xs">{l.sku}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  {l.quantity} {UNIT_LABELS[l.unit].short}
                  {l.remaining < l.quantity && (
                    <div className="text-muted-foreground text-xs">{l.remaining} left to credit</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKES(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right">
                  <input type="hidden" name={`lines.${i}.lineId`} value={l.id} />
                  <Input
                    name={`lines.${i}.quantity`}
                    type="number"
                    min={0}
                    max={l.remaining}
                    step={1}
                    inputMode="numeric"
                    disabled={l.remaining === 0}
                    aria-label={`${l.description} quantity to credit`}
                    aria-invalid={errors(`lines.${i}.quantity`) ? true : undefined}
                    className="ml-auto w-24 text-right"
                    value={qty[l.id] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                  />
                  {errors(`lines.${i}.quantity`)?.map((m) => (
                    <p key={m} className="text-destructive text-xs">
                      {m}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors("lines")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id="reason"
          label="Reason (printed on the credit note)"
          errors={errors("reason")}
          className="sm:col-span-2"
        >
          <Textarea
            name="reason"
            rows={2}
            placeholder="e.g. 2 packets damaged, returned by the driver"
            defaultValue={correcting?.reason}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="returnsToStock"
            className="size-4"
            defaultChecked={correcting?.returnsToStock}
          />
          The goods came back and can be sold again: put them back into stock
        </label>
      </div>
      <p className="text-sm" aria-live="polite">
        Credit note total: <strong>{formatKES(total.toFixed(2))}</strong>
        {total.greaterThan(0) && (
          <>
            {" "}
            · Reduces this invoice by {formatKES(toInvoice.toFixed(2))}
            {toCredit.greaterThan(0) && (
              <> · {formatKES(toCredit.toFixed(2))} becomes credit on the account</>
            )}
          </>
        )}
      </p>
      {correcting && (
        <Field
          id="why"
          label="Why is it being changed? (kept in the audit log, not printed)"
          errors={errors("why")}
        >
          <Input name="why" placeholder="e.g. Only one carton was damaged, not two" />
        </Field>
      )}
      {correcting ? (
        <SubmitBar pending={pending} state={state} label="Save corrected credit note" pendingLabel="Saving…">
          <span className="text-muted-foreground text-sm">
            {correcting.number} is cancelled and a corrected credit note is issued with the next number.
          </span>
        </SubmitBar>
      ) : (
        <SubmitBar pending={pending} state={state} label="Issue credit note" pendingLabel="Issuing…">
          <span className="text-muted-foreground text-sm">
            Only an owner or administrator can change a credit note once issued.
          </span>
        </SubmitBar>
      )}
    </form>
  );
}
