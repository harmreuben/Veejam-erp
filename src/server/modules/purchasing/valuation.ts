import "server-only";

import { todayInNairobi } from "@/lib/dates";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { formatQuantity } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { nextNumber } from "@/server/db/sequence";
import { ConflictError, NotFoundError } from "@/server/errors";
import { postStockValue } from "@/server/modules/accounting/journal";
import { lockValuations } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

import { revalueSchema } from "./schemas";

/**
 * Set what one product's stock on hand is worth, e.g. its opening cost when
 * the old system had none. The difference goes to Opening balances (setting
 * up) or Stock gains and losses (a correction), and is journalled.
 */
export async function revalueStock(db: Db, actor: Actor, input: unknown, ctx: AuditContext = {}) {
  authorize(actor, "inventory.revalue");
  const v = parseInput(revalueSchema, input);
  return db.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: v.productId } });
    if (!product) throw new NotFoundError();
    const valuation = (await lockValuations(tx, [product.id])).get(product.id)!;
    if (valuation.quantity <= 0) {
      throw new ConflictError(
        `There is no ${product.name} in stock to value. New stock comes in at its purchase cost.`,
      );
    }
    const newValue = roundMoney(toDecimal(v.costPerPiece).times(valuation.quantity));
    if (newValue.equals(valuation.value)) {
      throw new ConflictError(`${product.name} is already valued at ${formatKES(newValue.toFixed(2))}.`);
    }
    const number = await nextNumber(tx, "STOCK_REVALUATION");
    const rev = await tx.stockRevaluation.create({
      data: {
        number,
        productId: product.id,
        quantity: valuation.quantity,
        oldValue: valuation.value.toFixed(2),
        newValue: newValue.toFixed(2),
        againstOpening: v.againstOpening,
        reason: v.reason,
        createdById: actor.id,
      },
    });
    await tx.inventoryValuation.update({
      where: { productId: product.id },
      data: { quantity: valuation.quantity, value: newValue.toFixed(2) },
    });
    await tx.product.update({
      where: { id: product.id },
      data: { costPrice: roundMoney(v.costPerPiece).toFixed(2), version: { increment: 1 } },
    });
    const change = newValue.minus(valuation.value);
    await postStockValue(tx, {
      change,
      against: v.againstOpening ? "OPENING" : "STOCK_ADJ",
      date: todayInNairobi(),
      description: `Stock value ${number}: ${product.name} ${formatQuantity(valuation.quantity, product)} at ${formatKES(v.costPerPiece)} a piece — ${v.reason}`,
      sourceType: "StockRevaluation",
      sourceId: rev.id,
      sourceNumber: number,
      actorId: actor.id,
    });
    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "STOCK_REVALUED",
      entityType: "Product",
      entityId: product.id,
      summary: `${number} ${product.name}: ${formatKES(valuation.value.toFixed(2))} → ${formatKES(newValue.toFixed(2))} (${v.againstOpening ? "opening balance" : "correction"}): ${v.reason}`,
      before: { value: valuation.value.toFixed(2) },
      after: { value: newValue.toFixed(2), costPerPiece: v.costPerPiece },
      ...ctx,
    });
    return { number, value: newValue.toFixed(2), change: change.toFixed(2) };
  });
}
