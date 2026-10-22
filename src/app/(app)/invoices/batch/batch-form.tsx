"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { calculateLine, sumLines, type LineTotals } from "@/lib/sales-math";
import { formatQuantity, piecesPerUnit, UNIT_LABELS, type Unit } from "@/lib/units";

import type { EditorProps } from "../../_sales/document-editor";
import { batchInvoiceAction } from "../../_sales/actions";

type Data = EditorProps["data"];
type Line = { key: number; productId: string; unit: Unit; quantity: string };
type Card = { key: number; customerId: string; reference: string; lines: Line[] };
type Result = {
  index: number;
  id: string | null;
  number?: string | null;
  posted: boolean;
  problem: string | null;
  customerName?: string;
  total?: string;
};

let seq = 1;
const blankLine = (): Line => ({ key: seq++, productId: "", unit: "CARTON", quantity: "" });
const blankCard = (): Card => ({ key: seq++, customerId: "", reference: "", lines: [blankLine()] });

/**
 * Several invoices on one page. Prices are previewed with the same lookup the
 * server uses; stock warnings count what earlier invoices in the batch take.
 * After posting, the cards are cleared except ones that couldn't even be saved.
 */
export function BatchForm({ data, today, initialKey }: { data: Data; today: string; initialKey: string }) {
  const { state, submit, pending, errors } = useActionForm(batchInvoiceAction);
  const [warehouseId, setWarehouseId] = useState(data.warehouses[0]?.id ?? "");
  const [cards, setCards] = useState<Card[]>(() => [blankCard(), blankCard()]);
  const [batchKey, setBatchKey] = useState(initialKey);
  // The cards' order when the batch was sent, to match the results back to them.
  const [submittedKeys, setSubmittedKeys] = useState<number[]>([]);
  const [handledAt, setHandledAt] = useState<number | undefined>(undefined);
  const [results, setResults] = useState<Result[]>([]);

  // When a batch comes back: show what happened, keep only the cards that weren't saved, start a new key.
  if (state.at && state.at !== handledAt) {
    setHandledAt(state.at);
    if (state.ok && state.data?.results) {
      const rs = JSON.parse(state.data.results) as Result[];
      setResults(rs);
      const unsaved = new Set(rs.filter((r) => r.id === null).map((r) => submittedKeys[r.index]));
      setCards((prev) => {
        const kept = prev.filter((c) => unsaved.has(c.key));
        return kept.length ? kept : [blankCard()];
      });
      setBatchKey(crypto.randomUUID());
    }
  }

  const products = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);

  function priceFor(customerId: string, productId: string, unit: Unit, rate: string) {
    const customer = customers.get(customerId);
    const lists = [customer?.priceListId, data.defaultPriceListId]
      .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
      .map((id) => data.priceLists.find((l) => l.id === id))
      .filter((l): l is NonNullable<typeof l> => !!l);
    const inclusive = lists[0]?.pricesIncludeTax ?? true;
    for (const list of lists) {
      const p = data.prices[list.id]?.[`${productId}|${unit}`];
      if (p) {
        if (list.pricesIncludeTax === inclusive) return { price: p, inclusive };
        const r = toDecimal(rate);
        const converted = list.pricesIncludeTax
          ? roundMoney(toDecimal(p).times(100).dividedBy(r.plus(100)))
          : roundMoney(toDecimal(p).times(r.plus(100)).dividedBy(100));
        return { price: converted.toFixed(2), inclusive };
      }
    }
    return { price: null, inclusive };
  }

  // Work out each card's lines, and stock used so far across the batch.
  const used = new Map<string, number>();
  const view = cards.map((card) => {
    const rows = card.lines.map((line) => {
      const p = products.get(line.productId);
      if (!p)
        return {
          line,
          p: null,
          price: null,
          t: null as LineTotals | null,
          pieces: null,
          short: false,
          left: 0,
        };
      const rate = data.taxRates[p.taxCategory] ?? "0";
      const { price, inclusive } = priceFor(card.customerId, p.id, line.unit, rate);
      const qty = Number(line.quantity);
      const ok = Number.isInteger(qty) && qty > 0;
      const t =
        price && ok
          ? calculateLine({ quantity: qty, unitPrice: price, discountPercent: "0", taxRate: rate }, inclusive)
          : null;
      const pieces = ok ? qty * piecesPerUnit(line.unit, p) : null;
      const before = used.get(p.id) ?? 0;
      const left = (p.available[warehouseId] ?? 0) - before;
      if (pieces) used.set(p.id, before + pieces);
      return { line, p, price, t, pieces, short: pieces !== null && pieces > left, left };
    });
    const totals = sumLines(rows.flatMap((r) => (r.t ? [r.t] : [])));
    const filled = !!card.customerId || rows.some((r) => r.p);
    return { card, rows, totals, filled };
  });
  const toPost = view.filter((v) => v.filled);
  const grand = toPost.reduce((s, v) => s.plus(v.totals.total), toDecimal(0));

  const updateCard = (key: number, patch: Partial<Card>) =>
    setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const updateLine = (cardKey: number, lineKey: number, patch: Partial<Line>) =>
    setCards((cs) =>
      cs.map((c) =>
        c.key === cardKey
          ? { ...c, lines: c.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) }
          : c,
      ),
    );

  return (
    <div className="grid gap-6">
      {results.length > 0 && <BatchResults results={results} />}

      <form
        onSubmit={(e) => {
          setSubmittedKeys(cards.map((c) => c.key));
          submit(e);
        }}
        className="grid gap-6"
        noValidate
      >
        <input type="hidden" name="batchKey" value={batchKey} />
        <input type="hidden" name="issueDate" value={today} />
        <div className="grid max-w-md gap-4">
          <Field
            id="warehouseId"
            label="Sell from"
            errors={errors("warehouseId")}
            hint="Every invoice in the batch takes stock from here."
          >
            <select
              name="warehouseId"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className={selectClass}
            >
              {data.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {view.map(({ card, rows, totals }, ci) => (
          <fieldset key={card.key} className="bg-card grid gap-3 rounded-lg border p-4">
            <legend className="sr-only">Invoice {ci + 1}</legend>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold" aria-hidden>
                Invoice {ci + 1}
              </h2>
              <button
                type="button"
                onClick={() =>
                  setCards((cs) => (cs.length > 1 ? cs.filter((c) => c.key !== card.key) : [blankCard()]))
                }
                aria-label={`Remove invoice ${ci + 1}`}
                className="text-muted-foreground hover:text-foreground inline-flex size-8 items-center justify-center rounded-md"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <select
                name={`invoices.${ci}.customerId`}
                value={card.customerId}
                onChange={(e) => updateCard(card.key, { customerId: e.target.value })}
                aria-label={`Invoice ${ci + 1} customer`}
                className={selectClass}
              >
                <option value="">Choose a customer…</option>
                {data.customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
              <Input
                name={`invoices.${ci}.customerReference`}
                value={card.reference}
                onChange={(e) => updateCard(card.key, { reference: e.target.value })}
                placeholder="Customer's LPO number (optional)"
                aria-label={`Invoice ${ci + 1} customer's LPO number`}
              />
            </div>

            <div className="grid gap-2">
              {rows.map(({ line, p, price, t, pieces, short, left }, li) => (
                <div key={line.key} className="grid gap-1">
                  <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_5rem_2.25rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_5.5rem_7.5rem_2.25rem]">
                    <select
                      name={`invoices.${ci}.lines.${li}.productId`}
                      value={line.productId}
                      onChange={(e) => updateLine(card.key, line.key, { productId: e.target.value })}
                      aria-label={`Invoice ${ci + 1} line ${li + 1} product`}
                      className={`${selectClass} col-span-4 sm:col-span-1`}
                    >
                      <option value="">Choose a product…</option>
                      {data.products.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.sku})
                        </option>
                      ))}
                    </select>
                    <select
                      name={`invoices.${ci}.lines.${li}.unit`}
                      value={line.unit}
                      onChange={(e) => updateLine(card.key, line.key, { unit: e.target.value as Unit })}
                      aria-label={`Invoice ${ci + 1} line ${li + 1} unit`}
                      className={selectClass}
                    >
                      {(["CARTON", "PACK", "PIECE"] as const).map((u) => (
                        <option key={u} value={u}>
                          {UNIT_LABELS[u].many[0]!.toUpperCase() + UNIT_LABELS[u].many.slice(1)}
                        </option>
                      ))}
                    </select>
                    <Input
                      name={`invoices.${ci}.lines.${li}.quantity`}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) => updateLine(card.key, line.key, { quantity: e.target.value })}
                      aria-label={`Invoice ${ci + 1} line ${li + 1} quantity`}
                    />
                    <span className="hidden text-right text-sm font-medium tabular-nums sm:block">
                      {t ? formatKES(t.grossAmount) : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateCard(card.key, {
                          lines:
                            card.lines.length > 1
                              ? card.lines.filter((l) => l.key !== line.key)
                              : [blankLine()],
                        })
                      }
                      aria-label={`Remove invoice ${ci + 1} line ${li + 1}`}
                      className="text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-md"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  {p && (
                    <p className="text-muted-foreground px-1 text-xs" aria-live="polite">
                      {pieces !== null && <>= {formatQuantity(pieces, p)}. </>}
                      {price ? (
                        <span className="sm:hidden">{t ? `${formatKES(t.grossAmount)}. ` : ""}</span>
                      ) : (
                        <span className="text-destructive">No price for this unit. </span>
                      )}
                      <span className={short ? "text-warning font-medium" : undefined}>
                        Left in stock{ci > 0 ? " after the invoices above" : ""}:{" "}
                        {formatQuantity(Math.max(left, 0), p)}
                        {short ? " — not enough; this invoice will stay a draft." : "."}
                      </span>
                    </p>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => updateCard(card.key, { lines: [...card.lines, blankLine()] })}
                  className="hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm"
                >
                  <Plus className="size-4" aria-hidden /> Add line
                </button>
                <span className="text-sm">
                  Total <strong className="tabular-nums">{formatKES(totals.total)}</strong>
                </span>
              </div>
            </div>
          </fieldset>
        ))}

        <button
          type="button"
          onClick={() => setCards((cs) => [...cs, blankCard()])}
          disabled={cards.length >= 40}
          className="hover:bg-muted inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-dashed px-4 text-sm disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden /> Add another customer
        </button>
        {errors("invoices")?.map((m) => (
          <p key={m} role="alert" className="text-destructive text-sm">
            {m}
          </p>
        ))}

        <SubmitBar
          pending={pending}
          state={state}
          label={`Post ${toPost.length} invoice${toPost.length === 1 ? "" : "s"}`}
          pendingLabel="Posting…"
        >
          <span className="text-muted-foreground text-sm" aria-live="polite">
            Together <strong className="text-foreground tabular-nums">{formatKES(grand.toFixed(2))}</strong>,
            including VAT. Prices are worked out again on the server.
          </span>
        </SubmitBar>
      </form>
    </div>
  );
}

function BatchResults({ results }: { results: Result[] }) {
  const posted = results.filter((r) => r.posted);
  const drafts = results.filter((r) => !r.posted && r.id);
  const unsaved = results.filter((r) => !r.id);
  return (
    <section aria-labelledby="batch-results" className="bg-card grid gap-3 rounded-lg border p-4">
      <h2 id="batch-results" className="text-base font-semibold">
        Last batch: {posted.length} posted
        {drafts.length > 0 && `, ${drafts.length} kept as draft${drafts.length === 1 ? "" : "s"}`}
        {unsaved.length > 0 && `, ${unsaved.length} not saved`}
      </h2>
      <ul className="grid gap-2 text-sm">
        {posted.map((r) => (
          <li key={r.index} className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="text-success size-4" aria-hidden />
            <Link href={`/invoices/${r.id}`} className="font-mono hover:underline">
              {r.number}
            </Link>
            {r.customerName} · {formatKES(r.total ?? "0")}
          </li>
        ))}
        {drafts.map((r) => (
          <li key={r.index} className="flex flex-wrap items-start gap-2">
            <CircleAlert className="text-warning mt-0.5 size-4" aria-hidden />
            <span>
              <Link href={`/invoices/${r.id}`} className="font-medium hover:underline">
                Draft for {r.customerName}
              </Link>{" "}
              not posted: {r.problem}
            </span>
          </li>
        ))}
        {unsaved.map((r) => (
          <li key={r.index} className="flex flex-wrap items-start gap-2">
            <CircleAlert className="text-destructive mt-0.5 size-4" aria-hidden />
            <span>
              Invoice {r.index + 1} wasn&apos;t saved: {r.problem} It&apos;s still below to fix.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
