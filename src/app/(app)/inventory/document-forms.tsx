"use client";

import { useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

import { postAdjustmentAction, postTransferAction } from "./actions";
import { LineEditor, type ProductOption } from "./line-editor";

type Warehouse = { id: string; name: string };

export function AdjustmentForm({
  idempotencyKey,
  warehouses,
  products,
  reasons,
}: {
  idempotencyKey: string;
  warehouses: Warehouse[];
  products: ProductOption[];
  reasons: { value: string; label: string; directions: ("IN" | "OUT")[] }[];
}) {
  const { state, submit, pending, errors } = useActionForm(postAdjustmentAction);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [reason, setReason] = useState(reasons[0]?.value ?? "");
  const directions = reasons.find((r) => r.value === reason)?.directions ?? ["IN", "OUT"];

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="warehouseId" label="Warehouse" errors={errors("warehouseId")}>
          <select
            name="warehouseId"
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className={selectClass}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="reason" label="Reason" errors={errors("reason")}>
          <select
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={selectClass}
          >
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="notes"
          label="Notes"
          hint="Required for Correction and Other. Say what happened."
          errors={errors("notes")}
          className="sm:col-span-2"
        >
          <Textarea name="notes" rows={2} />
        </Field>
      </div>
      {/* Re-mount lines when the reason's allowed directions change, so every line is valid. */}
      <LineEditor
        key={directions.join()}
        products={products}
        warehouseId={warehouseId}
        withDirection
        allowedDirections={directions}
        errors={errors}
      />
      <SubmitBar pending={pending} state={state} label="Post adjustment" pendingLabel="Posting…">
        <span className="text-muted-foreground text-sm">
          Posted adjustments can&apos;t be edited; correct mistakes with another adjustment.
        </span>
      </SubmitBar>
    </form>
  );
}

export function TransferForm({
  idempotencyKey,
  warehouses,
  products,
}: {
  idempotencyKey: string;
  warehouses: Warehouse[];
  products: ProductOption[];
}) {
  const { state, submit, pending, errors } = useActionForm(postTransferAction);
  const [fromId, setFromId] = useState(warehouses[0]?.id ?? "");
  const [toId, setToId] = useState(warehouses[1]?.id ?? "");
  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="fromWarehouseId" label="From" errors={errors("fromWarehouseId")}>
          <select
            name="fromWarehouseId"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className={selectClass}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="toWarehouseId" label="To" errors={errors("toWarehouseId")}>
          <select
            name="toWarehouseId"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
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
          id="notes"
          label="Notes"
          hint="e.g. loaded for Tuesday's route"
          errors={errors("notes")}
          className="sm:col-span-2"
        >
          <Textarea name="notes" rows={2} />
        </Field>
      </div>
      <LineEditor products={products} warehouseId={fromId} withDirection={false} errors={errors} />
      <SubmitBar pending={pending} state={state} label="Post transfer" pendingLabel="Posting…" />
    </form>
  );
}
