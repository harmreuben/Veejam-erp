"use client";

import { useEffect, useRef } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { saveWarehouseAction } from "../actions";

export function WarehouseForm({
  warehouse,
}: {
  warehouse?: { id: string; code: string; name: string; location: string | null; status: string };
}) {
  const { state, submit, pending, errors } = useActionForm(saveWarehouseAction);
  const ref = useRef<HTMLFormElement>(null);
  const idPrefix = warehouse ? `wh-${warehouse.id}` : "wh-new";
  useEffect(() => {
    if (!warehouse && state.ok && state.at) ref.current?.reset();
  }, [state, warehouse]);

  return (
    <form ref={ref} onSubmit={submit} className="bg-card grid gap-4 rounded-lg border p-5" noValidate>
      {warehouse && <input type="hidden" name="id" value={warehouse.id} />}
      <div className="grid items-start gap-4 sm:grid-cols-4">
        <Field id={`${idPrefix}-code`} label="Code" errors={errors("code")}>
          <Input name="code" defaultValue={warehouse?.code} autoCapitalize="characters" />
        </Field>
        <Field id={`${idPrefix}-name`} label="Name" errors={errors("name")}>
          <Input name="name" defaultValue={warehouse?.name} />
        </Field>
        <Field id={`${idPrefix}-location`} label="Location" errors={errors("location")}>
          <Input name="location" defaultValue={warehouse?.location ?? ""} />
        </Field>
        <Field id={`${idPrefix}-status`} label="Status" errors={errors("status")}>
          <select name="status" defaultValue={warehouse?.status ?? "ACTIVE"} className={selectClass}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </Field>
      </div>
      <SubmitBar pending={pending} state={state} label={warehouse ? "Save" : "Add warehouse"} />
    </form>
  );
}
