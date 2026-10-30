import "server-only";

import type { DayRange } from "@/lib/dates";
import { fromDbDate, toDbDate } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";

/**
 * Goods customers sent back: issued credit notes that put stock back on the
 * shelf ("returned to stock"), in a date range. Deleted or replaced credit
 * notes are left out (their stock was taken back out again). The cost of what
 * came back is what the stock ledger valued it at.
 */
export async function salesReturns(db: Db, actor: Actor, range: DayRange) {
  authorize(actor, "sales.view");
  const notes = await db.salesDocument.findMany({
    where: {
      kind: "CREDIT_NOTE",
      status: "POSTED",
      deletedAt: null,
      returnsToStock: true,
      issueDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
    },
    orderBy: [{ issueDate: "desc" }, { number: "desc" }],
    include: {
      customer: { select: { id: true, name: true, code: true } },
      sourceDocument: { select: { id: true, number: true } },
      warehouse: { select: { name: true } },
      lines: { orderBy: { position: "asc" } },
    },
  });
  const movements = notes.length
    ? await db.stockMovement.groupBy({
        by: ["sourceId"],
        where: { sourceType: "CreditNote", type: "RETURN_IN", sourceId: { in: notes.map((n) => n.id) } },
        _sum: { costValue: true },
      })
    : [];
  const costOf = new Map(movements.map((m) => [m.sourceId, toDecimal(m._sum.costValue ?? 0)]));

  const byProduct = new Map<
    string,
    { label: string; sku: string; pieces: number; value: ReturnType<typeof toDecimal> }
  >();
  let pieces = 0;
  let value = toDecimal(0);
  let cost = toDecimal(0);
  const rows = notes.map((n) => {
    const notePieces = n.lines.reduce((s, l) => s + l.pieces, 0);
    pieces += notePieces;
    value = value.plus(n.total);
    cost = cost.plus(costOf.get(n.id) ?? 0);
    for (const l of n.lines) {
      const p = byProduct.get(l.productId) ?? {
        label: l.description,
        sku: l.sku,
        pieces: 0,
        value: toDecimal(0),
      };
      p.pieces += l.pieces;
      p.value = p.value.plus(l.grossAmount);
      byProduct.set(l.productId, p);
    }
    return {
      id: n.id,
      number: n.number!,
      date: fromDbDate(n.issueDate),
      customer: n.customer,
      invoice: n.sourceDocument,
      warehouse: n.warehouse.name,
      reason: n.notes,
      items: n.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit })),
      pieces: notePieces,
      total: n.total.toFixed(2),
      cost: costOf.has(n.id) ? costOf.get(n.id)!.toFixed(2) : null,
    };
  });
  return {
    rows,
    count: rows.length,
    pieces,
    value: value.toFixed(2),
    cost: cost.toFixed(2),
    byProduct: [...byProduct.entries()]
      .map(([id, p]) => ({ id, ...p, value: p.value.toFixed(2) }))
      .sort((a, b) => Number(b.value) - Number(a.value)),
  };
}
