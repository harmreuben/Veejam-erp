"use client";

import { Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { selectClass } from "@/components/filters";
import { SubmitBar, useActionForm } from "@/components/forms";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { breakdown, formatQuantity, piecesPerUnit } from "@/lib/units";

import { cancelCountAction, saveCountAction, startCountAction } from "../actions";

export function StartCountForm({ warehouses }: { warehouses: { id: string; name: string }[] }) {
  const { state, submit, pending, errors } = useActionForm(startCountAction);
  return (
    <form onSubmit={submit} className="bg-card grid gap-4 rounded-lg border p-5" noValidate>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id="warehouseId" label="Warehouse" errors={errors("warehouseId")}>
          <select name="warehouseId" className={selectClass}>
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
          hint="e.g. Month-end count, or cut-over opening stock"
          errors={errors("notes")}
        >
          <Textarea name="notes" rows={1} />
        </Field>
      </div>
      <SubmitBar pending={pending} state={state} label="Start count" pendingLabel="Starting…" />
    </form>
  );
}

type CountLine = {
  productId: string;
  sku: string;
  name: string;
  unitsPerPack: number;
  packsPerCarton: number;
  expectedQuantity: number;
  countedQuantity: number | null;
};

type Entry = { cartons: string; packs: string; pieces: string };

function initialEntry(l: CountLine): Entry {
  if (l.countedQuantity === null) return { cartons: "", packs: "", pieces: "" };
  const b = breakdown(l.countedQuantity, l);
  return { cartons: String(b.cartons), packs: String(b.packs), pieces: String(b.pieces) };
}

function total(e: Entry, l: CountLine): number | null {
  if (e.cartons === "" && e.packs === "" && e.pieces === "") return null;
  const n = (s: string) => (s === "" ? 0 : Number(s));
  const t = n(e.cartons) * piecesPerUnit("CARTON", l) + n(e.packs) * piecesPerUnit("PACK", l) + n(e.pieces);
  return Number.isFinite(t) ? t : null;
}

export function CountSheet({
  countId,
  version,
  lines,
  canPost,
}: {
  countId: string;
  version: number;
  lines: CountLine[];
  canPost: boolean;
}) {
  const { state, submit, pending, errors } = useActionForm(saveCountAction);
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(lines.map((l) => [l.productId, initialEntry(l)])),
  );
  const formRef = useRef<HTMLFormElement>(null);
  const postRef = useRef<HTMLButtonElement>(null);
  const counted = lines.filter((l) => total(entries[l.productId]!, l) !== null).length;
  const set = (id: string, field: keyof Entry, value: string) =>
    setEntries((e) => ({ ...e, [id]: { ...e[id]!, [field]: value } }));

  // Posting submits through a dedicated hidden button, so the plain Save button never posts.
  const post = () => formRef.current?.requestSubmit(postRef.current);

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-4" noValidate>
      <input type="hidden" name="id" value={countId} />
      <input type="hidden" name="version" value={version} />
      <button ref={postRef} type="submit" name="intent" value="post" hidden tabIndex={-1} aria-hidden />
      <div className="bg-card overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-muted-foreground border-b text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Product
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">
                Cartons
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">
                Packs
              </th>
              <th scope="col" className="px-2 py-2.5 text-right font-medium">
                Pieces
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Counted
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                System expects
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l, i) => {
              const e = entries[l.productId]!;
              const t = total(e, l);
              const diff = t === null ? null : t - l.expectedQuantity;
              const err = ["cartons", "packs", "pieces"].flatMap((f) => errors(`lines.${i}.${f}`) ?? []);
              return (
                <tr key={l.productId}>
                  <td className="px-4 py-2">
                    <input type="hidden" name={`lines.${i}.productId`} value={l.productId} />
                    <span className="font-medium">{l.name}</span>
                    <div className="text-muted-foreground text-xs">
                      {l.sku} · {l.unitsPerPack} pcs/pk · {l.packsPerCarton} pk/ctn
                    </div>
                    {err.length > 0 && <div className="text-destructive text-xs">{err.join(" ")}</div>}
                  </td>
                  {(["cartons", "packs", "pieces"] as const).map((f) => (
                    <td key={f} className="px-2 py-2">
                      <Input
                        name={`lines.${i}.${f}`}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={e[f]}
                        onChange={(ev) => set(l.productId, f, ev.target.value)}
                        aria-label={`${l.name} ${f}`}
                        className="ml-auto w-20 text-right tabular-nums"
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right whitespace-nowrap tabular-nums">
                    {t === null ? (
                      <span className="text-muted-foreground">Not counted</span>
                    ) : (
                      `${t.toLocaleString("en-KE")} pcs`
                    )}
                    {diff !== null && diff !== 0 && (
                      <div className={diff < 0 ? "text-destructive text-xs" : "text-success text-xs"}>
                        {diff > 0 ? "+" : "−"}
                        {formatQuantity(Math.abs(diff), l)}
                      </div>
                    )}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-right text-xs whitespace-nowrap">
                    {formatQuantity(l.expectedQuantity, l)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-sm">
        {counted} of {lines.length} products counted. Leave a product blank to keep its current balance. Enter
        0 if there are none.
      </p>
      <SubmitBar pending={pending} state={state} label="Save counts">
        {canPost && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="secondary" disabled={pending || counted === 0}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                Post count…
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>Post this count?</AlertDialogTitle>
              <AlertDialogDescription>
                The {counted} counted product{counted === 1 ? "" : "s"} will be set to exactly the counted
                quantity. Differences are recorded as count gains or losses. This can&apos;t be undone, only
                corrected by another count or adjustment.
              </AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep counting</AlertDialogCancel>
                <AlertDialogAction onClick={post}>Post count</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </SubmitBar>
      {!canPost && (
        <p className="text-muted-foreground text-sm">
          When counting is finished, ask an owner or administrator to check and post it.
        </p>
      )}
    </form>
  );
}

export function CancelCountButton({ countId }: { countId: string }) {
  const { submit, pending } = useActionForm(cancelCountAction);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} onSubmit={submit}>
      <input type="hidden" name="id" value={countId} />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="ghost" className="text-destructive" disabled={pending}>
            Cancel count
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Cancel this count?</AlertDialogTitle>
          <AlertDialogDescription>
            Entered figures are kept for the record, but no stock changes.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => ref.current?.requestSubmit()}
            >
              Cancel count
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
