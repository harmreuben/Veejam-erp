"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useActionForm } from "@/components/forms";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";

import { revalueStockAction } from "./actions";

/**
 * Set what a product's stock on hand cost, per piece. For opening stock that
 * came across without a cost, or to correct a wrong value.
 */
export function RevalueButton({
  productId,
  name,
  pieces,
  quantityText,
  suggested,
  uncosted,
}: {
  productId: string;
  name: string;
  pieces: number;
  quantityText: string;
  suggested: string | null;
  uncosted: boolean;
}) {
  const { submit, pending, state, errors } = useActionForm(revalueStockAction);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [cost, setCost] = useState(suggested ?? "");
  const succeeded = state.ok && !!state.at && openedAt !== null && state.at >= openedAt;
  const open = openedAt !== null && !succeeded;
  const valid = /^\d+(\.\d{1,4})?$/.test(cost.trim());
  return (
    <AlertDialog open={open} onOpenChange={(o) => setOpenedAt(o ? Date.now() : null)}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant={uncosted ? "default" : "ghost"}>
          {uncosted ? "Set cost" : "Change"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <input type="hidden" name="productId" value={productId} />
          <AlertDialogTitle>What did the {name} on hand cost?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2 text-sm">
              <p>
                {quantityText} are in stock. Enter the cost of one piece, excluding VAT (e.g. the carton cost
                on the supplier&apos;s invoice divided by the pieces in a carton). Sales from now on carry
                this cost.
              </p>
            </div>
          </AlertDialogDescription>
          <div className="grid gap-1.5">
            <Label htmlFor="rv-cost">Cost per piece (KES)</Label>
            <Input
              id="rv-cost"
              name="costPerPiece"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
            {valid && pieces > 0 && (
              <p className="text-muted-foreground text-xs">
                Stock value: {formatKES(roundMoney(toDecimal(cost.trim()).times(pieces)).toFixed(2))}
              </p>
            )}
            {errors("costPerPiece") && (
              <p className="text-destructive text-xs">{errors("costPerPiece")!.join(" ")}</p>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="againstOpening" defaultChecked={uncosted} className="mt-1" />
            <span>
              This is opening stock (setting up the books)
              <span className="text-muted-foreground block text-xs">
                Unticked, the change counts as a stock gain or loss in this period&apos;s profit.
              </span>
            </span>
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="rv-reason">Where the cost comes from</Label>
            <Textarea
              id="rv-reason"
              name="reason"
              rows={2}
              placeholder="e.g. Mars invoice 12345, September 2026"
            />
            {errors("reason") && <p className="text-destructive text-xs">{errors("reason")!.join(" ")}</p>}
          </div>
          {!state.ok && state.message && !errors("costPerPiece") && !errors("reason") && (
            <p role="alert" className="text-destructive text-sm">
              {state.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Back</AlertDialogCancel>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Save cost
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
