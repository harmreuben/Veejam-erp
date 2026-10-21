"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { formToObject } from "@/server/action-helpers";
import { toActionResult, type ActionResult } from "@/server/action-result";
import { requestContext, requireUser, toActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import {
  createPriceList,
  savePrices,
  setDefaultPriceList,
  updatePriceList,
} from "@/server/modules/pricing/service";

export async function createPriceListAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let id = "";
  const result = await toActionResult(async () => {
    const user = await requireUser();
    const list = await createPriceList(
      getDb(),
      toActor(user),
      formToObject(formData),
      await requestContext(),
    );
    id = list.id;
    revalidatePath("/price-lists");
    return `${list.name} created`;
  });
  if (result.ok && id) redirect(`/price-lists/${id}`);
  return result;
}

export async function updatePriceListAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    await updatePriceList(getDb(), toActor(user), id, formToObject(formData), await requestContext());
    revalidatePath("/price-lists");
    revalidatePath(`/price-lists/${id}`);
    return "Price list saved";
  });
}

export async function makeDefaultAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    await setDefaultPriceList(getDb(), toActor(user), id, await requestContext());
    revalidatePath("/price-lists");
    revalidatePath(`/price-lists/${id}`);
    return "Default price list changed";
  });
}

/** Grid inputs are named "price:<productId>:<UNIT>". */
export async function savePricesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return toActionResult(async () => {
    const user = await requireUser();
    const id = String(formData.get("id") ?? "");
    const entries: { productId: string; unit: string; price: string }[] = [];
    for (const [key, value] of formData.entries()) {
      const m = /^price:([0-9a-f-]{36}):(PIECE|PACK|CARTON)$/.exec(key);
      if (m && typeof value === "string") entries.push({ productId: m[1]!, unit: m[2]!, price: value });
    }
    const changed = await savePrices(getDb(), toActor(user), id, entries, await requestContext()).catch(
      (e: unknown) => {
        // Errors arrive keyed by list position ("4.price"); point them at the grid cell instead.
        if (e instanceof ValidationError) {
          const mapped: Record<string, string[]> = {};
          for (const [key, messages] of Object.entries(e.fieldErrors)) {
            const entry = entries[Number(key.split(".")[0])];
            mapped[entry ? `price:${entry.productId}:${entry.unit}` : "form"] = messages;
          }
          throw new ValidationError(mapped, "Some prices aren't valid. Check the highlighted cells.");
        }
        throw e;
      },
    );
    revalidatePath(`/price-lists/${id}`);
    revalidatePath("/products", "layout");
    return changed ? `${changed} price${changed === 1 ? "" : "s"} saved` : "No prices changed";
  });
}
