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
import { calculateLine, sumLines } from "@/lib/sales-math";
import { formatQuantity, piecesPerUnit, UNIT_LABELS, type Unit } from "@/lib/units";

import { savePurchaseOrderAction } from "./actions";

export type PoProduct = {
  id: string;
  sku: string;
  name: string;
  unitsPerPack: number;
  packsPerCarton: number;
  costPerPiece: string | null;
  taxRate: string;
};

type Line = { key: number; productId: string; unit: Unit; quantity: string; unitCost: string };
let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, productId: "", unit: "CARTON", quantity: "", unitCost: "" });
const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());

export type PoInitial = {
  id?: string;
  version?: number;
  supplierId: string;
  warehouseId: string;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  lines: { productId: string; unit: Unit; quantity: number; unitCost: string }[];
};

export function PurchaseOrderForm({
  suppliers,
  warehouses,
  products,
  initial,
}: {
  suppliers: { id: string; name: string; code: string }[];
  warehouses: { id: string; name: string }[];
  products: PoProduct[];
  initial: PoInitial;
}) {
  const { state, submit, pending, errors } = useActionForm(savePurchaseOrderAction);
  const byId = new Map(products.map((p) => [p.id, p]));
  const [lines, setLines] = useState<Line[]>(() =>
    initial.lines.length
      ? initial.lines.map((l) => ({
          key: nextKey++,
          productId: l.productId,
          unit: l.unit,
          quantity: String(l.quantity),
          unitCost: l.unitCost,
        }))
      : [blank()],
  );
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  // Suggest the last cost per piece × pieces in the unit, until someone types a cost.
  const suggest = (productId: string, unit: Unit) => {
    const p = byId.get(productId);
    if (!p?.costPerPiece) return "";
    return roundMoney(toDecimal(p.costPerPiece).times(piecesPerUnit(unit, p))).toFixed(2);
  };

  const priced = lines.map((l) => {
    const p = byId.get(l.productId);
    const qty = Number(l.quantity);
    if (!p || !Number.isInteger(qty) || qty <= 0 || !isMoney(l.unitCost)) return null;
    return calculateLine(
      { quantity: qty, unitPrice: l.unitCost.replace(/,/g, ""), taxRate: p.taxRate },
      false,
    );
  });
  const totals = sumLines(priced.filter((x): x is NonNullable<typeof x> => x !== null));

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {initial.version && <input type="hidden" name="version" value={initial.version} />}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="supplierId" label="Supplier" errors={errors("supplierId")}>
          <select name="supplierId" defaultValue={initial.supplierId} className={selectClass}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </Field>
        <Field id="warehouseId" label="Deliver to" errors={errors("warehouseId")}>
          <select name="warehouseId" defaultValue={initial.warehouseId} className={selectClass}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="orderDate" label="Order date" errors={errors("orderDate")}>
          <Input name="orderDate" type="date" defaultValue={initial.orderDate} />
        </Field>
        <Field id="expectedDate" label="Expected delivery" hint="Optional" errors={errors("expectedDate")}>
          <Input name="expectedDate" type="date" defaultValue={initial.expectedDate ?? ""} />
        </Field>
        <Field id="notes" label="Notes for the supplier" errors={errors("notes")} className="sm:col-span-2">
          <Textarea name="notes" rows={2} defaultValue={initial.notes ?? ""} />
        </Field>
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-2 text-sm font-semibold">Products (costs excluding VAT)</legend>
        <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_8rem_6rem_9rem_8rem_2.5rem] gap-2 px-1 text-xs md:grid">
          <span>Product</span>
          <span>Unit</span>
          <span>Quantity</span>
          <span>Cost per unit</span>
          <span className="text-right">Amount</span>
          <span />
        </div>
        {lines.map((line, i) => {
          const p = byId.get(line.productId);
          const qty = Number(line.quantity);
          const t = priced[i];
          const lineErrors = ["productId", "unit", "quantity", "unitCost"].flatMap(
            (f) => errors(`lines.${i}.${f}`) ?? [],
          );
          return (
            <div
              key={line.key}
              className="bg-card grid gap-2 rounded-md border p-3 md:border-0 md:bg-transparent md:p-0"
            >
              <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_8rem_6rem_9rem_8rem_2.5rem] md:items-center">
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
                  aria-invalid={errors(`lines.${i}.productId`) ? true : undefined}
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
                  onChange={(e) => {
                    const unit = e.target.value as Unit;
                    const keep = line.unitCost && line.unitCost !== suggest(line.productId, line.unit);
                    update(line.key, {
                      unit,
                      unitCost: keep ? line.unitCost : suggest(line.productId, unit),
                    });
                  }}
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
                  aria-invalid={errors(`lines.${i}.quantity`) ? true : undefined}
                />
                <Input
                  name={`lines.${i}.unitCost`}
                  inputMode="decimal"
                  value={line.unitCost}
                  onChange={(e) => update(line.key, { unitCost: e.target.value })}
                  aria-label={`Line ${i + 1} cost per unit`}
                  aria-invalid={errors(`lines.${i}.unitCost`) ? true : undefined}
                />
                <span className="text-right text-sm tabular-nums">{t ? formatKES(t.netAmount) : "—"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== line.key) : ls))
                  }
                  disabled={lines.length === 1}
                  aria-label={`Remove line ${i + 1}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
              {(p || lineErrors.length > 0) && (
                <p className="text-muted-foreground px-1 text-xs" aria-live="polite">
                  {p && Number.isInteger(qty) && qty > 0 && (
                    <>= {formatQuantity(qty * piecesPerUnit(line.unit, p), p)}. </>
                  )}
                  {p && <>VAT {toDecimal(p.taxRate).toDecimalPlaces(2).toString()}%. </>}
                  {p?.costPerPiece && <>Last cost {formatKES(p.costPerPiece)} a piece. </>}
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
        {errors("lines")?.map((m) => (
          <p key={m} role="alert" className="text-destructive text-sm">
            {m}
          </p>
        ))}
      </fieldset>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-sm" aria-live="polite">
        <dt className="text-muted-foreground">Excluding VAT</dt>
        <dd className="text-right tabular-nums">{formatKES(totals.subtotal)}</dd>
        <dt className="text-muted-foreground">VAT</dt>
        <dd className="text-right tabular-nums">{formatKES(totals.taxTotal)}</dd>
        <dt className="font-semibold">Total</dt>
        <dd className="text-right font-semibold tabular-nums">{formatKES(totals.total)}</dd>
      </dl>

      <SubmitBar pending={pending} state={state} label="Save draft" pendingLabel="Saving…">
        <span className="text-muted-foreground text-sm">
          Totals are worked out again on the server when you save.
        </span>
      </SubmitBar>
    </form>
  );
}
