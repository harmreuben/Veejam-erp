"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatKES, toDecimal } from "@/lib/money";

import { closeBooksAction, createAccountAction, manualJournalAction, startAccountingAction } from "./actions";

export function StartAccountingButton() {
  const { submit, pending, state } = useActionForm(startAccountingAction);
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Start the books
      </Button>
      {!state.ok && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}

type Account = { id: string; code: string; name: string };
type Line = { key: number; accountId: string; debit: string; credit: string; description: string };
let k = 1;
const blank = (): Line => ({ key: k++, accountId: "", debit: "", credit: "", description: "" });
const amt = (v: string) =>
  /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim()) ? toDecimal(v.replace(/,/g, "")) : toDecimal(0);

export function JournalForm({ accounts, today }: { accounts: Account[]; today: string }) {
  const { state, submit, pending, errors } = useActionForm(manualJournalAction);
  const [lines, setLines] = useState<Line[]>(() => [blank(), blank()]);
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const debit = lines.reduce((s, l) => s.plus(amt(l.debit)), toDecimal(0));
  const credit = lines.reduce((s, l) => s.plus(amt(l.credit)), toDecimal(0));
  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-[12rem_1fr]">
        <Field id="date" label="Date" errors={errors("date")}>
          <Input name="date" type="date" defaultValue={today} />
        </Field>
        <Field id="description" label="Description" errors={errors("description")}>
          <Input name="description" placeholder="e.g. October rent paid from the bank" />
        </Field>
      </div>
      <div className="grid gap-2">
        <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_8rem_8rem_minmax(0,12rem)_2.5rem] gap-2 px-1 text-xs md:grid">
          <span>Account</span>
          <span>Debit</span>
          <span>Credit</span>
          <span>Line note</span>
          <span />
        </div>
        {lines.map((l, i) => (
          <div
            key={l.key}
            className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_8rem_8rem_minmax(0,12rem)_2.5rem]"
          >
            <select
              name={`lines.${i}.accountId`}
              value={l.accountId}
              onChange={(e) => update(l.key, { accountId: e.target.value })}
              aria-label={`Line ${i + 1} account`}
              aria-invalid={errors(`lines.${i}.accountId`) ? true : undefined}
              className={`${selectClass} col-span-2 md:col-span-1`}
            >
              <option value="">Choose an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </select>
            <Input
              name={`lines.${i}.debit`}
              inputMode="decimal"
              placeholder="Debit"
              aria-label={`Line ${i + 1} debit`}
              value={l.debit}
              onChange={(e) => update(l.key, { debit: e.target.value })}
            />
            <Input
              name={`lines.${i}.credit`}
              inputMode="decimal"
              placeholder="Credit"
              aria-label={`Line ${i + 1} credit`}
              value={l.credit}
              onChange={(e) => update(l.key, { credit: e.target.value })}
            />
            <Input
              name={`lines.${i}.description`}
              aria-label={`Line ${i + 1} note`}
              value={l.description}
              onChange={(e) => update(l.key, { description: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((x) => x.key !== l.key) : ls))}
              disabled={lines.length <= 2}
              aria-label={`Remove line ${i + 1}`}
              className="text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-md disabled:opacity-40"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
            {[...(errors(`lines.${i}.accountId`) ?? []), ...(errors(`lines.${i}.debit`) ?? [])].map((m) => (
              <p key={m} className="text-destructive col-span-full text-xs">
                {m}
              </p>
            ))}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, blank()])}
          className="hover:bg-muted inline-flex h-8 w-fit items-center gap-1.5 rounded-md border px-3 text-sm"
        >
          <Plus className="size-4" aria-hidden /> Add line
        </button>
        {errors("lines")?.map((m) => (
          <p key={m} role="alert" className="text-destructive text-sm">
            {m}
          </p>
        ))}
      </div>
      <p className="text-sm" aria-live="polite">
        Debits {formatKES(debit.toFixed(2))} · Credits {formatKES(credit.toFixed(2))}
        {!debit.equals(credit) && (
          <span className="text-destructive">
            {" "}
            · Difference {formatKES(debit.minus(credit).abs().toFixed(2))}
          </span>
        )}
      </p>
      <SubmitBar pending={pending} state={state} label="Post entry" pendingLabel="Posting…">
        <span className="text-muted-foreground text-sm">
          Posted entries can&apos;t be edited; correct them with another entry.
        </span>
      </SubmitBar>
    </form>
  );
}

export function CloseBooksForm({ current }: { current: string | null }) {
  const { submit, pending, errors, state } = useActionForm(closeBooksAction);
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3" noValidate>
      <Field
        id="booksClosedUntil"
        label="Books closed up to and including"
        errors={errors("booksClosedUntil")}
      >
        <Input name="booksClosedUntil" type="date" defaultValue={current ?? ""} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Save
      </Button>
      {!state.ok && !state.fieldErrors && state.message && (
        <p role="alert" className="text-destructive text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function NewAccountForm() {
  const { submit, pending, errors, state } = useActionForm(createAccountAction);
  return (
    <form onSubmit={submit} className="grid items-end gap-3 sm:grid-cols-[7rem_1fr_10rem_auto]" noValidate>
      <Field id="code" label="Code" errors={errors("code")}>
        <Input name="code" inputMode="numeric" placeholder="6500" />
      </Field>
      <Field id="name" label="Name" errors={errors("name")}>
        <Input name="name" placeholder="e.g. Electricity" />
      </Field>
      <Field id="type" label="Type" errors={errors("type")}>
        <select name="type" defaultValue="EXPENSE" className={selectClass}>
          <option value="ASSET">Asset</option>
          <option value="LIABILITY">Liability</option>
          <option value="EQUITY">Equity</option>
          <option value="INCOME">Income</option>
          <option value="EXPENSE">Expense</option>
        </select>
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Add account
      </Button>
      {!state.ok && !state.fieldErrors && state.message && (
        <p role="alert" className="text-destructive text-sm sm:col-span-4">
          {state.message}
        </p>
      )}
    </form>
  );
}
