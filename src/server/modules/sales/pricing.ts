import "server-only";

import type { Customer, Product } from "@/generated/prisma/client";
import type { SellUnit, TaxCategory } from "@/generated/prisma/enums";
import { todayInNairobi, fromDbDate } from "@/lib/dates";
import { roundMoney, toDecimal } from "@/lib/money";
import { calculateLine, sumLines, type DocumentTotals } from "@/lib/sales-math";
import { piecesPerUnit, UNIT_LABELS } from "@/lib/units";
import { hasPermission, type Actor } from "@/server/auth/permissions";
import type { DbOrTx } from "@/server/db/client";
import { ConflictError, ValidationError } from "@/server/errors";
import { getDefaultPriceListId } from "@/server/modules/pricing/service";

import type { DraftValues } from "./schemas";

export type PricedLine = {
  position: number;
  productId: string;
  sku: string;
  description: string;
  unit: SellUnit;
  quantity: number;
  piecesPerUnit: number;
  pieces: number;
  unitPrice: string;
  discountPercent: string;
  taxCategory: TaxCategory;
  taxRate: string;
  netAmount: string;
  discountAmount: string;
  taxAmount: string;
  grossAmount: string;
};

export type Priced = {
  lines: PricedLine[];
  totals: DocumentTotals;
  priceListId: string;
  pricesIncludeTax: boolean;
};

const key = (productId: string, unit: string) => `${productId}|${unit}`;

/** Convert a price between VAT-inclusive and VAT-exclusive, to the cent. */
function convertBasis(price: string, rate: string, fromInclusive: boolean, toInclusive: boolean): string {
  if (fromInclusive === toInclusive) return price;
  const r = toDecimal(rate);
  return fromInclusive
    ? roundMoney(toDecimal(price).times(100).dividedBy(r.plus(100))).toFixed(2)
    : roundMoney(toDecimal(price).times(r.plus(100)).dividedBy(100)).toFixed(2);
}

export function discountsOf(
  lines: { productId: string; unit: string; discountPercent: { toFixed(n: number): string } }[],
) {
  return new Map(lines.map((l) => [key(l.productId, l.unit), l.discountPercent.toFixed(2)]));
}

export async function currentTaxRates(db: DbOrTx): Promise<Map<TaxCategory, string>> {
  const rows = await db.taxRate.findMany();
  return new Map(rows.map((r) => [r.category, r.rate.toFixed(4)]));
}

/**
 * Prices a document was converted from, which keep applying:
 *  - a quotation's prices while the quotation is still valid;
 *  - a confirmed sales order's prices, always (the customer agreed to them).
 */
async function honouredPrices(tx: DbOrTx, sourceDocumentId: string | null) {
  if (!sourceDocumentId) return null;
  const source = await tx.salesDocument.findUnique({
    where: { id: sourceDocumentId },
    include: { lines: true },
  });
  if (!source) return null;
  if (source.kind === "QUOTATION" && source.validUntil && fromDbDate(source.validUntil) < todayInNairobi()) {
    return null;
  }
  return {
    number: source.number,
    pricesIncludeTax: source.pricesIncludeTax,
    lines: new Map(
      source.lines.map((l) => [
        key(l.productId, l.unit),
        {
          unitPrice: l.unitPrice.toFixed(2),
          discountPercent: l.discountPercent.toFixed(2),
          taxRate: l.taxRate.toFixed(4),
        },
      ]),
    ),
  };
}

/**
 * Work out every line from the database: product details, the price from the
 * customer's price list (or the default list), the current tax rate, and the
 * totals. Nothing the browser sends about prices or totals is trusted.
 */
export async function priceDocument(
  tx: DbOrTx,
  actor: Actor,
  args: {
    customer: Pick<Customer, "id" | "priceListId">;
    lines: DraftValues["lines"];
    sourceDocumentId: string | null;
    /** Discounts already on the saved draft (product|unit → %). Someone without the discount permission may keep these, not raise them. */
    existingDiscounts?: Map<string, string>;
  },
): Promise<Priced> {
  const ids = [...new Set(args.lines.map((l) => l.productId))];
  const products = new Map<string, Product>(
    (await tx.product.findMany({ where: { id: { in: ids } } })).map((p) => [p.id, p]),
  );
  if (products.size !== ids.length)
    throw new ConflictError("Some products no longer exist. Reload the page.");

  const rates = await currentTaxRates(tx);

  const listIds: string[] = [];
  if (args.customer.priceListId) listIds.push(args.customer.priceListId);
  const defaultId = await getDefaultPriceListId(tx);
  if (defaultId && !listIds.includes(defaultId)) listIds.push(defaultId);
  const lists = (await tx.priceList.findMany({ where: { id: { in: listIds }, status: "ACTIVE" } })).sort(
    (a, b) => listIds.indexOf(a.id) - listIds.indexOf(b.id),
  );
  const primary = lists[0];
  if (!primary) throw new ConflictError("There is no active price list. Set one up on Price lists first.");
  const items = await tx.priceListItem.findMany({
    where: { priceListId: { in: lists.map((l) => l.id) }, productId: { in: ids } },
  });

  const honoured = await honouredPrices(tx, args.sourceDocumentId);
  const canDiscount = hasPermission(actor, "sales.discount");
  const errors: Record<string, string[]> = {};

  const lines: PricedLine[] = args.lines.map((input, i) => {
    const p = products.get(input.productId)!;
    if (p.status !== "ACTIVE") {
      (errors[`lines.${i}.productId`] ??= []).push(`${p.name} is inactive and can't be sold`);
    }
    const rate = rates.get(p.taxCategory);
    if (rate === undefined) {
      throw new ConflictError(`There is no tax rate for ${p.taxCategory}. Set it on Settings → Tax rates.`);
    }

    const kept = honoured?.lines.get(key(p.id, input.unit));
    let unitPrice: string | null = null;
    if (kept) {
      unitPrice = convertBasis(
        kept.unitPrice,
        kept.taxRate,
        honoured!.pricesIncludeTax,
        primary.pricesIncludeTax,
      );
    } else {
      for (const list of lists) {
        const item = items.find(
          (x) => x.priceListId === list.id && x.productId === p.id && x.unit === input.unit,
        );
        if (item) {
          unitPrice = convertBasis(
            item.price.toFixed(2),
            rate,
            list.pricesIncludeTax,
            primary.pricesIncludeTax,
          );
          break;
        }
      }
    }
    if (unitPrice === null) {
      (errors[`lines.${i}.unit`] ??= []).push(
        `${p.name} has no price per ${UNIT_LABELS[input.unit].one} in ${primary.name}. Add it on Price lists, or choose another unit.`,
      );
      unitPrice = "0.00";
    }

    const discount = input.discountPercent ?? "0.00";
    if (
      toDecimal(discount).greaterThan(0) &&
      !canDiscount &&
      discount !== kept?.discountPercent &&
      discount !== args.existingDiscounts?.get(key(p.id, input.unit))
    ) {
      (errors[`lines.${i}.discountPercent`] ??= []).push(
        "Only an owner or administrator can give a discount",
      );
    }

    const perUnit = piecesPerUnit(input.unit, p);
    const totals = calculateLine(
      { quantity: input.quantity, unitPrice, discountPercent: discount, taxRate: rate },
      primary.pricesIncludeTax,
    );
    return {
      position: i + 1,
      productId: p.id,
      sku: p.sku,
      description: p.name,
      unit: input.unit,
      quantity: input.quantity,
      piecesPerUnit: perUnit,
      pieces: input.quantity * perUnit,
      unitPrice,
      discountPercent: discount,
      taxCategory: p.taxCategory,
      taxRate: rate,
      netAmount: totals.netAmount,
      discountAmount: totals.discountAmount,
      taxAmount: totals.taxAmount,
      grossAmount: totals.grossAmount,
    };
  });
  if (Object.keys(errors).length) throw new ValidationError(errors);

  return {
    lines,
    totals: sumLines(lines.map((l) => ({ ...l, listAmount: "0" }))),
    priceListId: primary.id,
    pricesIncludeTax: primary.pricesIncludeTax,
  };
}

/** True if re-pricing gave anything different from what is saved. */
export function pricesDiffer(
  saved: {
    position: number;
    unitPrice: { toFixed(n: number): string };
    taxRate: { toFixed(n: number): string };
    discountPercent: { toFixed(n: number): string };
    grossAmount: { toFixed(n: number): string };
  }[],
  fresh: PricedLine[],
): boolean {
  if (saved.length !== fresh.length) return true;
  const byPos = new Map(saved.map((s) => [s.position, s]));
  return fresh.some((f) => {
    const s = byPos.get(f.position);
    return (
      !s ||
      s.unitPrice.toFixed(2) !== f.unitPrice ||
      s.taxRate.toFixed(4) !== f.taxRate ||
      s.discountPercent.toFixed(2) !== f.discountPercent ||
      s.grossAmount.toFixed(2) !== f.grossAmount
    );
  });
}
