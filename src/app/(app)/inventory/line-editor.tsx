"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { selectClass } from "@/components/filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatQuantity, piecesPerUnit, UNIT_LABELS, type Unit } from "@/lib/units";

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
  unitsPerPack: number;
  packsPerCarton: number;
  /** Pieces on hand per warehouse id. */
  stock: Record<string, number>;
};

type Line = { key: number; productId: string; unit: Unit; quantity: string; direction: "IN" | "OUT" };

let nextKey = 1;
const blankLine = (direction: "IN" | "OUT"): Line => ({
  key: nextKey++,
  productId: "",
  unit: "CARTON",
  quantity: "",
  direction,
});

/**
 * Editable product lines. Inputs are named lines.N.field so the form posts
 * without any client-side JSON. Shows each line in pieces as you type, and the
 * stock available in the chosen warehouse.
 */
export function LineEditor({
  products,
  warehouseId,
  withDirection,
  allowedDirections = ["IN", "OUT"],
  errors,
}: {
  products: ProductOption[];
  warehouseId: string;
  withDirection: boolean;
  allowedDirections?: ("IN" | "OUT")[];
  errors: (name: string) => string[] | undefined;
}) {
  const [lines, setLines] = useState<Line[]>(() => [blankLine(allowedDirections[0] ?? "IN")]);
  const update = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <div className="grid gap-3">
      <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_7rem_8rem_6rem_2.5rem] gap-2 px-1 text-xs md:grid">
        <span>Product</span>
        {withDirection ? <span>Add / remove</span> : <span />}
        <span>Unit</span>
        <span>Quantity</span>
        <span />
      </div>
      {lines.map((line, i) => {
        const p = byId.get(line.productId);
        const qty = Number(line.quantity);
        const pieces = p && Number.isInteger(qty) && qty > 0 ? qty * piecesPerUnit(line.unit, p) : null;
        const available = p ? (p.stock[warehouseId] ?? 0) : null;
        const lineErrors = ["productId", "direction", "unit", "quantity"].flatMap(
          (f) => errors(`lines.${i}.${f}`) ?? [],
        );
        return (
          <div
            key={line.key}
            className="bg-card grid gap-2 rounded-md border p-3 md:border-0 md:bg-transparent md:p-0"
          >
            <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1fr)_7rem_8rem_6rem_2.5rem] md:items-center">
              <select
                name={`lines.${i}.productId`}
                value={line.productId}
                onChange={(e) => update(line.key, { productId: e.target.value })}
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
              {withDirection ? (
                <select
                  name={`lines.${i}.direction`}
                  value={line.direction}
                  onChange={(e) => update(line.key, { direction: e.target.value as "IN" | "OUT" })}
                  aria-label={`Line ${i + 1} add or remove`}
                  className={selectClass}
                >
                  {allowedDirections.includes("IN") && <option value="IN">Add</option>}
                  {allowedDirections.includes("OUT") && <option value="OUT">Remove</option>}
                </select>
              ) : (
                <span className="hidden md:block" />
              )}
              <select
                name={`lines.${i}.unit`}
                value={line.unit}
                onChange={(e) => update(line.key, { unit: e.target.value as Unit })}
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
              <p className="text-muted-foreground px-1 text-xs" aria-live="polite">
                {p && pieces !== null && <>= {formatQuantity(pieces, p)}. </>}
                {p && available !== null && <>In this warehouse now: {formatQuantity(available, p)}.</>}
                {lineErrors.length > 0 && <span className="text-destructive"> {lineErrors.join(" ")}</span>}
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
        onClick={() => setLines((ls) => [...ls, blankLine(allowedDirections[0] ?? "IN")])}
      >
        <Plus aria-hidden /> Add line
      </Button>
      {errors("lines")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}
    </div>
  );
}
