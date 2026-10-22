"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { calculateLine, sumLines, type LineTotals } from "@/lib/sales-math";
import { formatQuantity, piecesPerUnit, UNIT_LABELS, type Unit } from "@/lib/units";

import { saveDraftAction } from "./actions";

type Kind = "QUOTATION" | "SALES_ORDER" | "INVOICE";

export type EditorProps = {
  kind: Kind;
  data: {
    customers: {
      id: string;
      code: string;
      name: string;
      priceListId: string | null;
      paymentTermsDays: number;
    }[];
    warehouses: { id: string; name: string }[];
    products: {
      id: string;
      sku: string;
      name: string;
      unitsPerPack: number;
      packsPerCarton: number;
      taxCategory: string;
      /** Pieces available (on hand minus reserved) per warehouse id. */
      available: Record<string, number>;
    }[];
    priceLists: { id: string; name: string; pricesIncludeTax: boolean }[];
    prices: Record<string, Record<string, string>>;
    taxRates: Record<string, string>;
    defaultPriceListId: string | null;
    canDiscount: boolean;
    /** May post invoices: then saving a new invoice posts it straight away. */
    canPost?: boolean;
  };
  initial?: {
    id: string;
    version: number;
    customerId: string;
    warehouseId: string;
    issueDate: string;
    validUntil: string | null;
    customerReference: string | null;
    notes: string | null;
    lines: { productId: string; unit: Unit; quantity: number; discountPercent: string; unitPrice: string }[];
    /** Converted from another document: customer fixed, its prices kept. */
    fromSource: boolean;
    pricesIncludeTax: boolean;
  };
  defaults: { issueDate: string; validUntil: string; idempotencyKey?: string };
};

type Line = { key: number; productId: string; unit: Unit; quantity: string; discountPercent: string };

let nextKey = 1;
const blank = (): Line => ({
  key: nextKey++,
  productId: "",
  unit: "CARTON",
  quantity: "",
  discountPercent: "",
});

const SUBMIT_LABEL: Record<Kind, string> = {
  QUOTATION: "Save quotation",
  SALES_ORDER: "Save order",
  INVOICE: "Save draft invoice",
};

export function DocumentEditor({ kind, data, initial, defaults }: EditorProps) {
  const { state, submit, pending, errors } = useActionForm(saveDraftAction);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? data.warehouses[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    initial?.lines.length
      ? initial.lines.map((l) => ({
          key: nextKey++,
          productId: l.productId,
          unit: l.unit,
          quantity: String(l.quantity),
          discountPercent: toDecimal(l.discountPercent).isZero()
            ? ""
            : toDecimal(l.discountPercent).toString(),
        }))
      : [blank()],
  );
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const products = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const customer = data.customers.find((c) => c.id === customerId);
  const existingDiscounts = new Map(
    (initial?.lines ?? []).map((l) => [`${l.productId}|${l.unit}`, toDecimal(l.discountPercent).toString()]),
  );
  const savedPrices = new Map((initial?.lines ?? []).map((l) => [`${l.productId}|${l.unit}`, l.unitPrice]));

  // The same price lookup the server does, for the live preview only.
  const lists = [customer?.priceListId, data.defaultPriceListId]
    .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
    .map((id) => data.priceLists.find((l) => l.id === id))
    .filter((l): l is NonNullable<typeof l> => !!l);
  const primary = lists[0];
  const inclusive = initial?.fromSource ? initial.pricesIncludeTax : (primary?.pricesIncludeTax ?? true);

  function priceFor(productId: string, unit: Unit, rate: string): string | null {
    const k = `${productId}|${unit}`;
    if (initial?.fromSource && savedPrices.has(k)) return savedPrices.get(k)!;
    for (const list of lists) {
      const p = data.prices[list.id]?.[k];
      if (p) {
        if (list.pricesIncludeTax === inclusive) return p;
        const r = toDecimal(rate);
        return list.pricesIncludeTax
          ? roundMoney(toDecimal(p).times(100).dividedBy(r.plus(100))).toFixed(2)
          : roundMoney(toDecimal(p).times(r.plus(100)).dividedBy(100)).toFixed(2);
      }
    }
    return null;
  }

  const rows = lines.map((line) => {
    const p = products.get(line.productId);
    if (!p) return { line, p: null, price: null, totals: null as LineTotals | null, pieces: null };
    const rate = data.taxRates[p.taxCategory] ?? "0";
    const price = priceFor(p.id, line.unit, rate);
    const qty = Number(line.quantity);
    const disc = line.discountPercent.trim() === "" ? "0" : line.discountPercent.trim();
    let totals: LineTotals | null = null;
    if (
      price &&
      Number.isInteger(qty) &&
      qty > 0 &&
      /^\d{1,3}(\.\d{1,2})?$/.test(disc) &&
      Number(disc) <= 100
    ) {
      totals = calculateLine(
        { quantity: qty, unitPrice: price, discountPercent: disc, taxRate: rate },
        inclusive,
      );
    }
    const pieces = Number.isInteger(qty) && qty > 0 ? qty * piecesPerUnit(line.unit, p) : null;
    return { line, p, price, totals, pieces };
  });
  const totals = sumLines(rows.flatMap((r) => (r.totals ? [r.totals] : [])));
  const checksStock = kind !== "QUOTATION";
  const postsNow = kind === "INVOICE" && !!data.canPost;

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <input type="hidden" name="kind" value={kind} />
      {!initial && defaults.idempotencyKey && (
        <input type="hidden" name="idempotencyKey" value={defaults.idempotencyKey} />
      )}
      {initial && (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version} />
        </>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id="customerId"
          label="Customer"
          errors={errors("customerId")}
          hint={initial?.fromSource ? "Fixed: this was converted from another document." : undefined}
        >
          <select
            name="customerId"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={selectClass}
            disabled={initial?.fromSource}
          >
            <option value="">Choose a customer…</option>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </Field>
        {initial?.fromSource && <input type="hidden" name="customerId" value={customerId} />}
        <Field
          id="warehouseId"
          label="Sell from"
          errors={errors("warehouseId")}
          hint={kind === "INVOICE" ? "Stock leaves this warehouse when the invoice is posted." : undefined}
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
        <Field
          id="issueDate"
          label="Date"
          errors={errors("issueDate")}
          hint={kind === "INVOICE" ? "A posted invoice takes the date it is posted." : undefined}
        >
          <Input name="issueDate" type="date" defaultValue={initial?.issueDate ?? defaults.issueDate} />
        </Field>
        {kind === "QUOTATION" ? (
          <Field
            id="validUntil"
            label="Valid until"
            errors={errors("validUntil")}
            hint="Quoted prices are honoured on conversion until this date."
          >
            <Input
              name="validUntil"
              type="date"
              defaultValue={initial ? (initial.validUntil ?? "") : defaults.validUntil}
            />
          </Field>
        ) : (
          <Field
            id="customerReference"
            label="Customer's order or LPO number"
            errors={errors("customerReference")}
          >
            <Input name="customerReference" defaultValue={initial?.customerReference ?? ""} />
          </Field>
        )}
        {kind === "QUOTATION" && (
          <Field id="customerReference" label="Customer's reference" errors={errors("customerReference")}>
            <Input name="customerReference" defaultValue={initial?.customerReference ?? ""} />
          </Field>
        )}
        <Field
          id="notes"
          label="Notes (printed on the document)"
          errors={errors("notes")}
          className="sm:col-span-2"
        >
          <Textarea name="notes" rows={2} defaultValue={initial?.notes ?? ""} />
        </Field>
      </div>

      <div className="grid gap-3">
        <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_7rem_5.5rem_5rem_7rem_7.5rem_2.5rem] gap-2 px-1 text-xs lg:grid">
          <span>Product</span>
          <span>Unit</span>
          <span>Quantity</span>
          <span>Disc. %</span>
          <span className="text-right">Price</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {rows.map(({ line, p, price, totals: t, pieces }, i) => {
          const lineErrors = ["productId", "unit", "quantity", "discountPercent"].flatMap(
            (f) => errors(`lines.${i}.${f}`) ?? [],
          );
          const available = p ? (p.available[warehouseId] ?? 0) : null;
          const short = checksStock && p && pieces !== null && available !== null && pieces > available;
          const keptDiscount = existingDiscounts.get(`${line.productId}|${line.unit}`);
          const discountEditable = data.canDiscount;
          return (
            <div
              key={line.key}
              className="bg-card grid gap-2 rounded-md border p-3 lg:border-0 lg:bg-transparent lg:p-0"
            >
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(0,1fr)_7rem_5.5rem_5rem_7rem_7.5rem_2.5rem] lg:items-center">
                <select
                  name={`lines.${i}.productId`}
                  value={line.productId}
                  onChange={(e) => update(line.key, { productId: e.target.value })}
                  aria-label={`Line ${i + 1} product`}
                  aria-invalid={errors(`lines.${i}.productId`) ? true : undefined}
                  className={`${selectClass} col-span-2 lg:col-span-1`}
                >
                  <option value="">Choose a product…</option>
                  {data.products.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.sku})
                    </option>
                  ))}
                </select>
                <select
                  name={`lines.${i}.unit`}
                  value={line.unit}
                  onChange={(e) => update(line.key, { unit: e.target.value as Unit })}
                  aria-label={`Line ${i + 1} unit`}
                  aria-invalid={errors(`lines.${i}.unit`) ? true : undefined}
                  className={selectClass}
                >
                  {(["CARTON", "PACK", "PIECE"] as const).map((u) => (
                    <option key={u} value={u}>
                      {UNIT_LABELS[u].many[0]!.toUpperCase() + UNIT_LABELS[u].many.slice(1)}
                    </option>
                  ))}
                </select>
                <Input
                  name={`lines.${i}.quantity`}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                  aria-label={`Line ${i + 1} quantity`}
                  aria-invalid={errors(`lines.${i}.quantity`) ? true : undefined}
                />
                {discountEditable ? (
                  <Input
                    name={`lines.${i}.discountPercent`}
                    inputMode="decimal"
                    placeholder="Disc. %"
                    value={line.discountPercent}
                    onChange={(e) => update(line.key, { discountPercent: e.target.value })}
                    aria-label={`Line ${i + 1} discount percent`}
                    aria-invalid={errors(`lines.${i}.discountPercent`) ? true : undefined}
                  />
                ) : (
                  <>
                    <input type="hidden" name={`lines.${i}.discountPercent`} value={keptDiscount ?? ""} />
                    <span className="text-muted-foreground px-1 text-sm tabular-nums">
                      {keptDiscount && keptDiscount !== "0" ? `${keptDiscount}%` : "—"}
                    </span>
                  </>
                )}
                <span className="hidden px-1 text-right text-sm tabular-nums lg:block">
                  {p ? price ? formatKES(price) : <span className="text-destructive">No price</span> : ""}
                </span>
                <span className="px-1 text-right text-sm font-medium tabular-nums">
                  {t ? formatKES(t.grossAmount) : ""}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== line.key) : ls))
                  }
                  disabled={lines.length === 1}
                  aria-label={`Remove line ${i + 1}`}
                  className="text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-md disabled:opacity-40"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              {(p || lineErrors.length > 0) && (
                <p className="text-muted-foreground px-1 text-xs" aria-live="polite">
                  {p && pieces !== null && <>= {formatQuantity(pieces, p)}. </>}
                  {p && price && (
                    <span className="lg:hidden">
                      {formatKES(price)} per {UNIT_LABELS[line.unit].one}.{" "}
                    </span>
                  )}
                  {p && !price && (
                    <span className="text-destructive lg:hidden">No price for this unit. </span>
                  )}
                  {p && checksStock && available !== null && (
                    <span className={short ? "text-warning font-medium" : undefined}>
                      Available in this warehouse: {formatQuantity(Math.max(available, 0), p)}
                      {short ? " — not enough for this line." : "."}
                    </span>
                  )}
                  {lineErrors.length > 0 && <span className="text-destructive"> {lineErrors.join(" ")}</span>}
                </p>
              )}
            </div>
          );
        })}
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

      <div className="ml-auto grid w-full max-w-xs gap-1 text-sm" aria-live="polite">
        {!toDecimal(totals.discountTotal).isZero() && (
          <Row label="Discounts" value={`− ${formatKES(totals.discountTotal)}`} />
        )}
        <Row label="Total excl. VAT" value={formatKES(totals.subtotal)} />
        <Row label="VAT" value={formatKES(totals.taxTotal)} />
        <Row label="Total" value={formatKES(totals.total)} strong />
        <p className="text-muted-foreground text-xs">
          {inclusive ? "Prices include VAT." : "Prices exclude VAT."} Preview only: prices and totals are
          worked out again on the server when you save.
        </p>
      </div>

      {postsNow ? (
        <SubmitBar pending={pending} state={state} label="Post invoice" pendingLabel="Posting…">
          <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>
            Save as draft
          </Button>
          <span className="text-muted-foreground text-sm">
            Posting gives it an INV- number, takes the stock out and can&apos;t be undone (use a credit note).
          </span>
        </SubmitBar>
      ) : (
        <SubmitBar pending={pending} state={state} label={SUBMIT_LABEL[kind]} pendingLabel="Saving…">
          {kind === "INVOICE" && (
            <span className="text-muted-foreground text-sm">
              Saving keeps it as a draft for someone who can post invoices.
            </span>
          )}
        </SubmitBar>
      )}
    </form>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t pt-1 text-base font-semibold" : ""}`}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
