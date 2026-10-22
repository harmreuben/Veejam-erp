"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, toDecimal } from "@/lib/money";

import { recordSupplierPaymentAction } from "./actions";

type OpenBill = {
  id: string;
  number: string;
  date: string;
  due: string;
  total: string;
  outstanding: string;
};

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "MPESA", label: "M-Pesa" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
];

const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());
const dec = (v: string) => (isMoney(v) ? toDecimal(v.replace(/,/g, "").trim()) : toDecimal(0));

export function SupplierPaymentForm({
  suppliers,
  supplierId,
  bills,
  balance,
  idempotencyKey,
  today,
  preselect,
}: {
  suppliers: { id: string; label: string }[];
  supplierId: string | null;
  bills: OpenBill[];
  balance: { owedOnBills: string; paidInAdvance: string } | null;
  idempotencyKey: string;
  today: string;
  preselect: string | null;
}) {
  const router = useRouter();
  const { state, submit, pending, errors } = useActionForm(recordSupplierPaymentAction);
  const pre = bills.find((i) => i.id === preselect);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [amount, setAmount] = useState(pre ? pre.outstanding : "");
  const [mode, setMode] = useState<"auto" | "manual">(pre ? "manual" : "auto");
  const [amounts, setAmounts] = useState<Record<string, string>>(pre ? { [pre.id]: pre.outstanding } : {});
  // Until someone types in the bill amounts, a chosen bill follows the amount paid.
  const [touched, setTouched] = useState(false);
  const changeAmount = (value: string) => {
    setAmount(value);
    if (pre && !touched) {
      const v = dec(value);
      setAmounts({ [pre.id]: (v.lessThan(pre.outstanding) ? v : toDecimal(pre.outstanding)).toFixed(2) });
    }
  };

  // What "oldest first" would do, for the preview.
  const auto: Record<string, string> = {};
  let left = dec(amount);
  for (const inv of bills) {
    if (left.lessThanOrEqualTo(0)) break;
    const take = left.lessThan(inv.outstanding) ? left : toDecimal(inv.outstanding);
    auto[inv.id] = take.toFixed(2);
    left = left.minus(take);
  }
  const shown = mode === "auto" ? auto : amounts;
  const applied = Object.values(shown).reduce((s, v) => s.plus(dec(v)), toDecimal(0));
  const credit = dec(amount).minus(applied);

  return (
    <div className="grid gap-6">
      <Field id="supplier" label="Supplier">
        <select
          value={supplierId ?? ""}
          onChange={(e) => router.push(`/supplier-payments/new?supplier=${e.target.value}`)}
          className={selectClass}
        >
          <option value="">Choose a supplier…</option>
          {suppliers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>

      {supplierId && balance && (
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <input type="hidden" name="supplierId" value={supplierId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="allocate" value={mode} />
          <p className="bg-muted rounded-md p-3 text-sm">
            VeeJam owes <strong>{formatKES(balance.owedOnBills)}</strong> on {bills.length} bill
            {bills.length === 1 ? "" : "s"}
            {toDecimal(balance.paidInAdvance).greaterThan(0) && (
              <> and has already paid {formatKES(balance.paidInAdvance)} in advance</>
            )}
            .
          </p>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <Field id="amount" label="Amount paid (KES)" errors={errors("amount")}>
              <Input
                name="amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => changeAmount(e.target.value)}
              />
            </Field>
            <Field id="paidOn" label="Date paid" errors={errors("paidOn")}>
              <Input name="paidOn" type="date" defaultValue={today} max={today} />
            </Field>
            <Field id="method" label="How you paid" errors={errors("method")}>
              <select
                name="method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={selectClass}
              >
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="reference"
              label={
                method === "MPESA"
                  ? "M-Pesa code"
                  : method === "CHEQUE"
                    ? "Cheque number"
                    : "Reference (optional)"
              }
              hint={method === "MPESA" ? "Optional: the 10-character code in the M-Pesa message" : undefined}
              errors={errors("reference")}
            >
              <Input name="reference" autoCapitalize="characters" />
            </Field>
            <Field id="notes" label="Notes" errors={errors("notes")} className="sm:col-span-2">
              <Textarea name="notes" rows={2} />
            </Field>
          </div>

          {bills.length > 0 && (
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-semibold">Apply to bills</legend>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={mode === "auto"} onChange={() => setMode("auto")} />
                  Oldest first
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === "manual"}
                    onChange={() => {
                      setMode("manual");
                      setAmounts(auto);
                    }}
                  />
                  Choose amounts
                </label>
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Bill</th>
                      <th className="px-3 py-2 text-left font-medium">Due</th>
                      <th className="px-3 py-2 text-right font-medium">Left to pay</th>
                      <th className="px-3 py-2 text-right font-medium">Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((inv, i) => (
                      <tr key={inv.id} className="border-t">
                        <td className="px-3 py-2">
                          {inv.number}
                          <div className="text-muted-foreground text-xs">{inv.date}</div>
                        </td>
                        <td className="px-3 py-2">{inv.due}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatKES(inv.outstanding)}</td>
                        <td className="px-3 py-2 text-right">
                          <input type="hidden" name={`allocations.${i}.billId`} value={inv.id} />
                          {mode === "manual" ? (
                            <Input
                              name={`allocations.${i}.amount`}
                              inputMode="decimal"
                              aria-label={`Apply to ${inv.number}`}
                              className="ml-auto w-32 text-right"
                              value={amounts[inv.id] ?? ""}
                              onChange={(e) => {
                                setTouched(true);
                                setAmounts((a) => ({ ...a, [inv.id]: e.target.value }));
                              }}
                            />
                          ) : (
                            <span className="tabular-nums">
                              {auto[inv.id] ? formatKES(auto[inv.id]!) : "—"}
                            </span>
                          )}
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
            </fieldset>
          )}

          <p className="text-sm" aria-live="polite">
            Applied to bills: <strong>{formatKES(applied.toFixed(2))}</strong>
            {credit.greaterThan(0) && (
              <>
                {" "}
                · Paid in advance (applied to the next bill): <strong>{formatKES(credit.toFixed(2))}</strong>
              </>
            )}
            {credit.lessThan(0) && <span className="text-destructive"> · More than the amount paid</span>}
          </p>

          <SubmitBar pending={pending} state={state} label="Record payment" pendingLabel="Recording…">
            <span className="text-muted-foreground text-sm">
              Posted to the cash, M-Pesa or bank account straight away.
            </span>
          </SubmitBar>
        </form>
      )}
    </div>
  );
}
