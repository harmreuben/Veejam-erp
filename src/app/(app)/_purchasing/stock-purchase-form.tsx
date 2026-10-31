"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { formatQuantity, piecesPerUnit, UNIT_LABELS, type Unit } from "@/lib/units";
import {
  PAID_FROM,
  PAID_FROM_LABELS,
  type PaidFrom,
} from "@/server/modules/purchasing/stock-purchase-labels";

import { stockPurchaseAction } from "./actions";

type Product = {
  id: string;
  sku: string;
  name: string;
  unitsPerPack: number;
  packsPerCarton: number;
  costPerPiece: string | null;
};

const unitLabel = (u: Unit, n: number) => (n === 1 ? UNIT_LABELS[u].one : UNIT_LABELS[u].many);

/** What VeeJam bought from a supplier: the stock comes in at cost, and it's paid now or owed. */
export function StockPurchaseForm({
  idempotencyKey,
  today,
  vatRegistered,
  suppliers,
  warehouses,
  products,
}: {
  idempotencyKey: string;
  today: string;
  vatRegistered: boolean;
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
  products: Product[];
}) {
  const { state, submit, pending, errors } = useActionForm(stockPurchaseAction);
  const [paidFrom, setPaidFrom] = useState<PaidFrom>("CASH");
  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="supplierId" label="Supplier" errors={errors("supplierId")}>
          <select name="supplierId" defaultValue="" className={selectClass}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="supplierInvoiceNumber"
          label="Supplier's invoice or receipt number"
          errors={errors("supplierInvoiceNumber")}
        >
          <Input name="supplierInvoiceNumber" autoCapitalize="characters" />
        </Field>
        <Field id="purchasedOn" label="Date" errors={errors("purchasedOn")}>
          <Input name="purchasedOn" type="date" defaultValue={today} max={today} />
        </Field>
        <Field id="warehouseId" label="Into warehouse" errors={errors("warehouseId")}>
          <select name="warehouseId" defaultValue={warehouses[0]?.id} className={selectClass}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <section className="grid gap-2" aria-labelledby="sp-lines">
        <h2 id="sp-lines" className="text-sm font-semibold">
          What was bought{" "}
          <span className="text-muted-foreground font-normal">
            (product, unit, quantity, cost per unit
            {vatRegistered ? " excluding VAT" : ", what you actually paid"})
          </span>
        </h2>
        <DirectLines products={products} errors={errors} />
      </section>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">Payment</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAID_FROM.map((p) => (
            <label
              key={p}
              className="has-[:checked]:border-ring has-[:checked]:bg-secondary flex items-center gap-2 rounded-md border p-3 text-sm"
            >
              <input
                type="radio"
                name="paidFrom"
                value={p}
                checked={paidFrom === p}
                onChange={() => setPaidFrom(p)}
              />
              {PAID_FROM_LABELS[p]}
            </label>
          ))}
        </div>
        {errors("paidFrom")?.map((m) => (
          <p key={m} className="text-destructive text-sm">
            {m}
          </p>
        ))}
        {paidFrom !== "CREDIT" && (
          <Field
            id="reference"
            label={paidFrom === "MPESA" ? "M-Pesa code" : "Reference (optional)"}
            errors={errors("reference")}
            className="sm:max-w-xs"
          >
            <Input name="reference" autoCapitalize="characters" />
          </Field>
        )}
      </fieldset>

      <Field id="notes" label="Notes (optional)" errors={errors("notes")}>
        <Textarea name="notes" rows={2} />
      </Field>

      <SubmitBar pending={pending} state={state} label="Record purchase" pendingLabel="Recording…">
        <span className="text-muted-foreground text-sm">
          The stock goes in at these costs straight away
          {vatRegistered ? "; VAT at each product's rate is added and can be reclaimed" : ""}.
        </span>
      </SubmitBar>
    </form>
  );
}

type DLine = { key: number; productId: string; unit: Unit; quantity: string; unitCost: string };
let k = 1;
const blank = (): DLine => ({ key: k++, productId: "", unit: "CARTON", quantity: "", unitCost: "" });

function DirectLines({
  products,
  errors,
}: {
  products: Product[];
  errors: (n: string) => string[] | undefined;
}) {
  const [lines, setLines] = useState<DLine[]>(() => [blank()]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const update = (key: number, patch: Partial<DLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const suggest = (productId: string, unit: Unit) => {
    const p = byId.get(productId);
    return p?.costPerPiece
      ? roundMoney(toDecimal(p.costPerPiece).times(piecesPerUnit(unit, p))).toFixed(2)
      : "";
  };
  const total = lines.reduce((sum, l) => {
    const q = Number(l.quantity);
    const c = l.unitCost.replace(/,/g, "").trim();
    return Number.isInteger(q) && q > 0 && /^\d+(\.\d{1,2})?$/.test(c)
      ? sum.plus(roundMoney(toDecimal(c).times(q)))
      : sum;
  }, toDecimal(0));
  return (
    <div className="grid gap-3">
      {lines.map((line, i) => {
        const p = byId.get(line.productId);
        const q = Number(line.quantity);
        const lineErrors = ["productId", "quantity", "unitCost"].flatMap(
          (f) => errors(`lines.${i}.${f}`) ?? [],
        );
        return (
          <div
            key={line.key}
            className="bg-card grid gap-2 rounded-md border p-3 md:border-0 md:bg-transparent md:p-0"
          >
            <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_8rem_6rem_9rem_2.5rem] md:items-center">
              <select
                name={`lines.${i}.productId`}
                value={line.productId}
                onChange={(e) =>
                  update(line.key, {
                    productId: e.target.value,
                    unitCost: suggest(e.target.value, line.unit),
                  })
                }
                aria-label={`Line ${i + 1} product`}
                className={`${selectClass} col-span-2 md:col-span-1`}
              >
                <option value="">Choose a product…</option>
                {products.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.sku})
                  </option>
                ))}
              </select>
              <select
                name={`lines.${i}.unit`}
                value={line.unit}
                onChange={(e) =>
                  update(line.key, {
                    unit: e.target.value as Unit,
                    unitCost: suggest(line.productId, e.target.value as Unit),
                  })
                }
                aria-label={`Line ${i + 1} unit`}
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
              />
              <Input
                name={`lines.${i}.unitCost`}
                inputMode="decimal"
                placeholder="Cost per unit"
                value={line.unitCost}
                onChange={(e) => update(line.key, { unitCost: e.target.value })}
                aria-label={`Line ${i + 1} cost per unit`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== line.key) : ls))}
                disabled={lines.length === 1}
                aria-label={`Remove line ${i + 1}`}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            {(p || lineErrors.length > 0) && (
              <p className="text-muted-foreground px-1 text-xs">
                {p && Number.isInteger(q) && q > 0 && (
                  <>
                    = {formatQuantity(q * piecesPerUnit(line.unit, p), p)} ({q} {unitLabel(line.unit, q)}
                    ).{" "}
                  </>
                )}
                {lineErrors.length > 0 && <span className="text-destructive">{lineErrors.join(" ")}</span>}
              </p>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => setLines((ls) => [...ls, blank()])}
      >
        <Plus aria-hidden /> Add line
      </Button>
      <p className="text-right text-sm" aria-live="polite">
        Stock cost: <strong className="font-mono tabular-nums">{formatKES(total.toFixed(2))}</strong>
      </p>
      {errors("lines")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}
    </div>
  );
}
