"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { formatQuantity, piecesPerUnit, UNIT_LABELS, type Unit } from "@/lib/units";

import { receiveGoodsAction } from "./actions";

type OrderLine = {
  id: string;
  productId: string;
  sku: string;
  description: string;
  unit: Unit;
  ordered: number;
  outstanding: number;
  outstandingText: string;
  unitCost: string | null;
};
type Order = {
  id: string;
  number: string;
  supplier: { id: string; name: string };
  warehouseId: string;
  lines: OrderLine[];
};
type Product = {
  id: string;
  sku: string;
  name: string;
  unitsPerPack: number;
  packsPerCarton: number;
  costPerPiece: string | null;
};

const isMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, "").trim());
const unitLabel = (u: Unit, n: number) => (n === 1 ? UNIT_LABELS[u].one : UNIT_LABELS[u].many);

export function ReceiveForm({
  idempotencyKey,
  today,
  showCosts,
  orders,
  order,
  suppliers,
  warehouses,
  products,
}: {
  idempotencyKey: string;
  today: string;
  showCosts: boolean;
  orders: { id: string; number: string; supplier: string }[];
  order: Order | null;
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
  products: Product[];
}) {
  const router = useRouter();
  const { state, submit, pending, errors } = useActionForm(receiveGoodsAction);
  const [mode, setMode] = useState<"order" | "direct">(
    order || !showCosts ? "order" : orders.length ? "order" : "direct",
  );

  const header = (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <Field id="receivedOn" label="Date received" errors={errors("receivedOn")}>
        <Input name="receivedOn" type="date" defaultValue={today} max={today} />
      </Field>
      <Field id="warehouseId" label="Into warehouse" errors={errors("warehouseId")}>
        <select
          name="warehouseId"
          defaultValue={order?.warehouseId ?? warehouses[0]?.id}
          className={selectClass}
        >
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="supplierReference"
        label="Supplier's delivery note or invoice number"
        hint="Optional, but it makes matching the bill easy"
        errors={errors("supplierReference")}
      >
        <Input name="supplierReference" autoCapitalize="characters" />
      </Field>
      <Field id="notes" label="Notes" hint="e.g. 2 cartons damaged, refused" errors={errors("notes")}>
        <Textarea name="notes" rows={2} />
      </Field>
    </div>
  );

  return (
    <div className="grid gap-6">
      {showCosts && (
        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Receive against">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "order"} onChange={() => setMode("order")} />A purchase
            order
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "direct"} onChange={() => setMode("direct")} />
            No order (enter the costs)
          </label>
        </div>
      )}

      {mode === "order" && (
        <Field id="po" label="Purchase order">
          <select
            value={order?.id ?? ""}
            onChange={(e) => router.push(`/goods-received/new?po=${e.target.value}`)}
            className={selectClass}
          >
            <option value="">Choose an open order…</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number} — {o.supplier}
              </option>
            ))}
          </select>
        </Field>
      )}
      {mode === "order" && orders.length === 0 && !order && (
        <p className="text-muted-foreground text-sm">
          No orders are waiting for goods. Mark a purchase order as ordered first.
        </p>
      )}

      {mode === "order" && order && (
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="purchaseOrderId" value={order.id} />
          <input type="hidden" name="supplierId" value={order.supplier.id} />
          <p className="text-sm">
            From <strong>{order.supplier.name}</strong>. Enter what actually arrived; anything short stays on
            the order.
          </p>
          {header}
          <OrderLines lines={order.lines} showCosts={showCosts} errors={errors} />
          <SubmitBar pending={pending} state={state} label="Post goods received" pendingLabel="Posting…">
            <span className="text-muted-foreground text-sm">
              Stock goes in straight away. Posted notes can&apos;t be edited.
            </span>
          </SubmitBar>
        </form>
      )}

      {mode === "direct" && showCosts && (
        <form onSubmit={submit} className="grid gap-6" noValidate>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
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
          {header}
          <DirectLines products={products} errors={errors} />
          <SubmitBar pending={pending} state={state} label="Post goods received" pendingLabel="Posting…">
            <span className="text-muted-foreground text-sm">Stock goes in straight away at these costs.</span>
          </SubmitBar>
        </form>
      )}
    </div>
  );
}

function OrderLines({
  lines,
  showCosts,
  errors,
}: {
  lines: OrderLine[];
  showCosts: boolean;
  errors: (n: string) => string[] | undefined;
}) {
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, String(l.outstanding)])),
  );
  const [cost, setCost] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.unitCost ?? ""])),
  );
  const total = lines.reduce((s, l) => {
    const q = Number(qty[l.id]);
    const c = cost[l.id] ?? "";
    return Number.isInteger(q) && q > 0 && isMoney(c)
      ? s.plus(roundMoney(toDecimal(c.replace(/,/g, "")).times(q)))
      : s;
  }, toDecimal(0));
  return (
    <div className="grid gap-3">
      {lines.map((l, i) => {
        const lineErrors = ["quantity", "unitCost"].flatMap((f) => errors(`lines.${i}.${f}`) ?? []);
        return (
          <div
            key={l.id}
            className="bg-card grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem] sm:items-center"
          >
            <input type="hidden" name={`lines.${i}.orderLineId`} value={l.id} />
            <input type="hidden" name={`lines.${i}.productId`} value={l.productId} />
            <input type="hidden" name={`lines.${i}.unit`} value={l.unit} />
            <div>
              <p className="font-medium">{l.description}</p>
              <p className="text-muted-foreground text-xs">
                <span className="font-mono">{l.sku}</span> · still to come: {l.outstandingText}
              </p>
            </div>
            <label className="grid gap-1 text-xs">
              <span className="text-muted-foreground">Arrived ({UNIT_LABELS[l.unit].many})</span>
              <Input
                name={`lines.${i}.quantity`}
                type="number"
                min={0}
                max={l.outstanding}
                step={1}
                inputMode="numeric"
                value={qty[l.id] ?? ""}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                aria-label={`${l.description} quantity arrived`}
                aria-invalid={errors(`lines.${i}.quantity`) ? true : undefined}
              />
            </label>
            {showCosts ? (
              <label className="grid gap-1 text-xs">
                <span className="text-muted-foreground">Cost per {UNIT_LABELS[l.unit].one} (excl. VAT)</span>
                <Input
                  name={`lines.${i}.unitCost`}
                  inputMode="decimal"
                  value={cost[l.id] ?? ""}
                  onChange={(e) => setCost((c) => ({ ...c, [l.id]: e.target.value }))}
                  aria-label={`${l.description} cost per unit`}
                />
              </label>
            ) : (
              <span />
            )}
            {lineErrors.length > 0 && (
              <p className="text-destructive text-xs sm:col-span-3">{lineErrors.join(" ")}</p>
            )}
          </div>
        );
      })}
      {showCosts && (
        <p className="text-right text-sm" aria-live="polite">
          Value at cost: <strong className="tabular-nums">{formatKES(total.toFixed(2))}</strong> excl. VAT
        </p>
      )}
      {errors("lines")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}
    </div>
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
      {errors("lines")?.map((m) => (
        <p key={m} role="alert" className="text-destructive text-sm">
          {m}
        </p>
      ))}
    </div>
  );
}
