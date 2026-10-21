"use client";

import { useState } from "react";

import { SubmitBar, useActionForm } from "@/components/forms";
import { Input } from "@/components/ui/input";
import { formatKES, toDecimal } from "@/lib/money";

import { paymentAction } from "./actions";

/** Apply credit left on a payment or credit note to the customer's open invoices. */
export function ApplyCreditForm({
  id,
  source,
  available,
  invoices,
}: {
  id: string;
  source: "payment" | "creditNote";
  available: string;
  invoices: { id: string; number: string; due: string; outstanding: string }[];
}) {
  const { state, submit, pending, errors } = useActionForm(paymentAction);
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    let left = toDecimal(available);
    for (const inv of invoices) {
      if (left.lessThanOrEqualTo(0)) break;
      const take = left.lessThan(inv.outstanding) ? left : toDecimal(inv.outstanding);
      out[inv.id] = take.toFixed(2);
      left = left.minus(take);
    }
    return out;
  });
  const total = Object.values(amounts).reduce(
    (s, v) => s.plus(/^\d+(\.\d{1,2})?$/.test(v.trim()) ? v.trim() : "0"),
    toDecimal(0),
  );
  if (!invoices.length) {
    return (
      <p className="text-muted-foreground text-sm">This customer has no unpaid invoices to apply it to.</p>
    );
  }
  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="intent" value="apply" />
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[440px] text-sm">
          <thead className="bg-muted/50 text-muted-foreground text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Invoice</th>
              <th className="px-3 py-2 text-right font-medium">Left to pay</th>
              <th className="px-3 py-2 text-right font-medium">Apply</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, i) => (
              <tr key={inv.id} className="border-t">
                <td className="px-3 py-2">
                  {inv.number}
                  <div className="text-muted-foreground text-xs">Due {inv.due}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKES(inv.outstanding)}</td>
                <td className="px-3 py-2 text-right">
                  <input type="hidden" name={`allocations.${i}.invoiceId`} value={inv.id} />
                  <Input
                    name={`allocations.${i}.amount`}
                    inputMode="decimal"
                    aria-label={`Apply to ${inv.number}`}
                    className="ml-auto w-32 text-right"
                    value={amounts[inv.id] ?? ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [inv.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors("allocations")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}
      <SubmitBar
        pending={pending}
        state={state}
        label={`Apply ${formatKES(total.toFixed(2))}`}
        pendingLabel="Applying…"
      >
        <span className="text-muted-foreground text-sm">Available: {formatKES(available)}</span>
      </SubmitBar>
    </form>
  );
}
