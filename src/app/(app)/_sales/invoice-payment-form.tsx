"use client";

import { useState } from "react";

import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatKES, toDecimal } from "@/lib/money";
import { cn } from "@/lib/utils";

import { recordInvoicePaymentAction } from "../payments/actions";

const METHODS = [
  { value: "MPESA", label: "M-Pesa" },
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank" },
  { value: "CHEQUE", label: "Cheque" },
] as const;

const clean = (v: string) => v.replace(/,/g, "").trim();
const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(clean(v));

/**
 * Record a payment straight from an open invoice: the amount (filled in with
 * what is left to pay), how it was paid, the M-Pesa code or reference, and the
 * date. It is posted at once and goes to this invoice; anything over the balance
 * stays on the customer's account as credit.
 */
export function InvoicePaymentForm({
  invoiceId,
  balanceDue,
  idempotencyKey,
  today,
}: {
  invoiceId: string;
  balanceDue: string;
  idempotencyKey: string;
  today: string;
}) {
  const { state, submit, pending, errors } = useActionForm(recordInvoicePaymentAction);
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("MPESA");
  const [amount, setAmount] = useState(balanceDue);
  const extra = isMoney(amount) ? toDecimal(clean(amount)).minus(balanceDue) : toDecimal(0);
  const reference =
    method === "MPESA"
      ? { label: "M-Pesa code", hint: "The 10-character code in the M-Pesa message, e.g. SJK3H7QW2P" }
      : method === "CHEQUE"
        ? { label: "Cheque number", hint: undefined }
        : { label: "Reference (optional)", hint: undefined };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate aria-label="Record a payment">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="method" value={method} />

      <fieldset>
        <legend className="mb-2 text-sm font-medium">How did they pay?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={method === m.value}
              onClick={() => setMethod(m.value)}
              className={cn(
                "h-11 rounded-md border text-sm font-medium transition-colors",
                method === m.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Field
          id="pay-amount"
          label="Amount received (KES)"
          errors={errors("amount")}
          hint={`Left to pay: ${formatKES(balanceDue)}`}
        >
          <Input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono"
          />
        </Field>
        <Field id="pay-reference" label={reference.label} hint={reference.hint} errors={errors("reference")}>
          <Input name="reference" autoCapitalize="characters" autoComplete="off" />
        </Field>
        <Field id="pay-date" label="Date received" errors={errors("receivedOn")}>
          <Input name="receivedOn" type="date" defaultValue={today} max={today} />
        </Field>
      </div>

      {extra.greaterThan(0) && (
        <p className="text-sm" aria-live="polite">
          That is {formatKES(extra.toFixed(2))} more than this invoice needs. The extra is kept as credit on
          the customer&apos;s account.
        </p>
      )}
      {errors("allocations")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}

      <SubmitBar pending={pending} state={state} label="Record payment" pendingLabel="Recording…">
        <span className="text-muted-foreground text-sm">Posted straight away, with a receipt.</span>
      </SubmitBar>
    </form>
  );
}
