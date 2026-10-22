import "server-only";

import { createHash, randomInt, randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import {
  formatLongDay,
  formatShortDay,
  fromDbDate,
  periodRange,
  todayInNairobi,
  type DayRange,
} from "@/lib/dates";
import { formatKES, toDecimal } from "@/lib/money";
import { formatQuantity, UNIT_LABELS } from "@/lib/units";
import { writeAudit } from "@/server/audit/audit";
import { type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { AppError, ValidationError } from "@/server/errors";
import { listCustomers } from "@/server/modules/customers/service";
import { availability } from "@/server/modules/inventory/stock";
import { stockLevels } from "@/server/modules/inventory/queries";
import { METHOD_LABELS } from "@/server/modules/payments/schemas";
import {
  agedReceivables,
  customerBalance,
  customerStatement,
  openInvoices,
  recordPayment,
} from "@/server/modules/payments/service";
import type { AuditContext } from "@/server/modules/pricing/service";
import { resolvePrice } from "@/server/modules/pricing/service";
import { collections, salesTotals } from "@/server/modules/reports/service";
import { cancelDocument, createDraft, creditProblem, postInvoice } from "@/server/modules/sales/service";

import { HELP_TEXT, type Command, type Period, type SellLine } from "./parse";

/**
 * Runs a parsed command for an owner and returns the reply text.
 *
 * Read commands go through the same service functions (and permission checks)
 * as the web app. Commands that change data never change anything straight
 * away: they save a draft and a confirmation, and the change is made only when
 * the owner replies YES with the code — after checking nothing moved meanwhile.
 */

export const CONFIRM_MINUTES = 5;
const MAX_WRONG_CODES = 3;
const LIST_LIMIT = 8;

export type CommandContext = { db: Db; actor: Actor; waNumber: string; audit: AuditContext; now?: Date };

const kes = (v: Prisma.Decimal | string | number) => formatKES(typeof v === "object" ? v.toFixed(2) : v);
/** "owe KES 1,000.00", or "are KES 500.00 in credit" when the balance is negative. */
function owes(balance: string): string {
  const b = toDecimal(balance);
  return b.lessThan(0) ? `are ${kes(b.negated().toFixed(2))} in credit` : `owe ${kes(b.toFixed(2))}`;
}

const hashCode = (id: string, code: string) => createHash("sha256").update(`${id}:${code}`).digest("hex");

const PERIOD_LABEL: Record<Period, string> = {
  today: "today",
  yesterday: "yesterday",
  week: "this week",
  month: "this month",
};

function rangeLabel(r: DayRange): string {
  return r.from === r.to ? formatShortDay(r.from) : `${formatShortDay(r.from)} – ${formatShortDay(r.to)}`;
}

function more(total: number, shown: number): string {
  return total > shown ? `\n…and ${total - shown} more. Open the ERP for the full list.` : "";
}

// ─── Finding customers and products from free text ──────────────────

type Found<T> = { ok: true; value: T } | { ok: false; reply: string };

async function findCustomer(
  db: Db,
  actor: Actor,
  text: string,
): Promise<Found<{ id: string; code: string; name: string; creditLimit: string; status: string }>> {
  const t = text.trim();
  const code = /^CUS-?0*(\d{1,9})$/i.exec(t.replace(/\s/g, ""));
  if (code) {
    const c = await db.customer.findUnique({ where: { code: `CUS-${code[1]!.padStart(6, "0")}` } });
    if (c) return { ok: true, value: { ...c, creditLimit: c.creditLimit.toFixed(2) } };
    return { ok: false, reply: `No customer has the code ${t.toUpperCase()}.` };
  }
  const matches = (await listCustomers(db, actor, { q: t, status: "ACTIVE" })).slice(0, 50);
  const exact = matches.filter((c) => c.name.toLowerCase() === t.toLowerCase());
  const pick = exact.length === 1 ? exact : matches;
  if (pick.length === 1) return { ok: true, value: pick[0]! };
  if (pick.length === 0)
    return {
      ok: false,
      reply: `No active customer matches "${t}". Try CUSTOMER ${t.split(" ")[0]} to search.`,
    };
  return {
    ok: false,
    reply:
      `"${t}" matches ${pick.length} customers. Send the command again with the code:\n` +
      pick
        .slice(0, LIST_LIMIT)
        .map((c) => `${c.code} ${c.name}`)
        .join("\n") +
      more(pick.length, LIST_LIMIT),
  };
}

type FoundProduct = { id: string; sku: string; name: string; unitsPerPack: number; packsPerCarton: number };

async function findProduct(db: Db, text: string): Promise<Found<FoundProduct>> {
  const t = text.trim();
  const select = { id: true, sku: true, name: true, unitsPerPack: true, packsPerCarton: true } as const;
  const bySku = await db.product.findFirst({
    where: { sku: { equals: t, mode: "insensitive" }, status: "ACTIVE" },
    select,
  });
  if (bySku) return { ok: true, value: bySku };
  const matches = await db.product.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { name: { contains: t, mode: "insensitive" } },
        { sku: { contains: t, mode: "insensitive" } },
        { brand: { contains: t, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    select,
    take: 50,
  });
  const exact = matches.filter((p) => p.name.toLowerCase() === t.toLowerCase());
  const pick = exact.length === 1 ? exact : matches;
  if (pick.length === 1) return { ok: true, value: pick[0]! };
  if (pick.length === 0)
    return { ok: false, reply: `No active product matches "${t}". Try PRODUCT ${t.split(" ")[0]}.` };
  return {
    ok: false,
    reply:
      `"${t}" matches ${pick.length} products. Use the SKU:\n` +
      pick
        .slice(0, LIST_LIMIT)
        .map((p) => `${p.sku} ${p.name}`)
        .join("\n") +
      more(pick.length, LIST_LIMIT),
  };
}

async function mainWarehouseId(db: Db): Promise<string | null> {
  const main = await db.warehouse.findFirst({
    where: { code: "MAIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (main) return main.id;
  const first = await db.warehouse.findFirst({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

// ─── Read commands ───────────────────────────────────────────────────

async function stock(c: CommandContext, product: string): Promise<string> {
  const found = await findProduct(c.db, product);
  if (!found.ok) return found.reply;
  const p = found.value;
  const balances = await c.db.stockBalance.findMany({
    where: { productId: p.id },
    include: { warehouse: { select: { id: true, name: true } } },
  });
  const sizes = { unitsPerPack: p.unitsPerPack, packsPerCarton: p.packsPerCarton };
  const lines: string[] = [];
  let available = 0;
  let onHand = 0;
  for (const b of balances) {
    const a = (await availability(c.db, b.warehouseId, [p.id])).get(p.id)!;
    onHand += a.onHand;
    available += a.available;
    if (a.onHand !== 0 || a.reserved !== 0) {
      lines.push(
        `${b.warehouse.name}: ${formatQuantity(a.onHand, sizes)}` +
          (a.reserved ? ` (${formatQuantity(a.reserved, sizes)} reserved for orders)` : ""),
      );
    }
  }
  return [
    `*${p.name}* (${p.sku})`,
    `On hand: ${formatQuantity(onHand, sizes)}`,
    available !== onHand ? `Free to sell: ${formatQuantity(available, sizes)}` : null,
    ...(lines.length > 1 ? lines : []),
  ]
    .filter(Boolean)
    .join("\n");
}

async function price(c: CommandContext, product: string): Promise<string> {
  const found = await findProduct(c.db, product);
  if (!found.ok) return found.reply;
  const p = found.value;
  const rows: string[] = [];
  let incl: boolean | null = null;
  for (const unit of ["PIECE", "PACK", "CARTON"] as const) {
    const r = await resolvePrice(c.db, { productId: p.id, unit });
    if (r) {
      rows.push(`${UNIT_LABELS[unit].one}: ${kes(r.price)}`);
      incl = r.pricesIncludeTax;
    }
  }
  if (!rows.length) return `${p.name} has no price on the default price list yet.`;
  return [`*${p.name}* (${p.sku}) — default prices${incl ? ", VAT included" : ", plus VAT"}`, ...rows].join(
    "\n",
  );
}

async function products(c: CommandContext, query: string): Promise<string> {
  const rows = await c.db.product.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
        { brand: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    include: { balances: { select: { quantity: true } } },
    take: 50,
  });
  if (!rows.length) return `No active product matches "${query}".`;
  return (
    rows
      .slice(0, LIST_LIMIT)
      .map(
        (p) =>
          `${p.sku} ${p.name} — ${formatQuantity(
            p.balances.reduce((s, b) => s + b.quantity, 0),
            p,
          )}`,
      )
      .join("\n") + more(rows.length, LIST_LIMIT)
  );
}

async function customers(c: CommandContext, query: string): Promise<string> {
  const rows = await listCustomers(c.db, c.actor, { q: query, status: "ACTIVE" });
  if (!rows.length) return `No active customer matches "${query}".`;
  const shown = rows.slice(0, LIST_LIMIT);
  const out: string[] = [];
  for (const r of shown) {
    const b = await customerBalance(c.db, r.id);
    out.push(`${r.code} ${r.name}${r.town ? `, ${r.town}` : ""} — owes ${kes(b.balance)}`);
  }
  return out.join("\n") + more(rows.length, LIST_LIMIT);
}

async function balance(c: CommandContext, text: string): Promise<string> {
  const found = await findCustomer(c.db, c.actor, text);
  if (!found.ok) return found.reply;
  const cu = found.value;
  const b = await customerBalance(c.db, cu.id);
  const open = await openInvoices(c.db, cu.id);
  const today = todayInNairobi(c.now);
  const overdue = open
    .filter((i) => (i.dueDate ? fromDbDate(i.dueDate) : fromDbDate(i.issueDate)) < today)
    .reduce((s, i) => s.plus(i.outstanding), toDecimal(0));
  return [
    `*${cu.name}* (${cu.code})`,
    toDecimal(b.balance).lessThan(0)
      ? `In credit: ${kes(toDecimal(b.balance).negated().toFixed(2))}`
      : `Owes: ${kes(b.balance)}`,
    open.length ? `Unpaid invoices: ${open.length}, ${kes(b.owedOnInvoices)}` : "No unpaid invoices.",
    overdue.greaterThan(0) ? `Overdue: ${kes(overdue.toFixed(2))}` : null,
    toDecimal(b.unappliedCredit).greaterThan(0) ? `Credit not yet applied: ${kes(b.unappliedCredit)}` : null,
    `Credit limit: ${toDecimal(cu.creditLimit).isZero() ? "none (cash only)" : kes(cu.creditLimit)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function statement(c: CommandContext, text: string): Promise<string> {
  const found = await findCustomer(c.db, c.actor, text);
  if (!found.ok) return found.reply;
  const st = await customerStatement(c.db, c.actor, found.value.id, {});
  const lines = st.lines.slice(-LIST_LIMIT);
  return [
    `*Statement — ${found.value.name}*`,
    st.lines.length > LIST_LIMIT ? `(last ${LIST_LIMIT} of ${st.lines.length} entries)` : null,
    ...lines.map(
      (l) =>
        `${formatShortDay(l.date)} ${l.kind} ${l.reference}: ` +
        (toDecimal(l.debit).greaterThan(0) ? `+${kes(l.debit)}` : `−${kes(l.credit)}`) +
        ` → ${kes(l.balance)}`,
    ),
    `Balance: ${kes(st.closing)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sales(c: CommandContext, period: Period): Promise<string> {
  const range = periodRange(period, todayInNairobi(c.now));
  const [t, money] = await Promise.all([salesTotals(c.db, range), collections(c.db, range)]);
  return [
    `*Sales ${PERIOD_LABEL[period]}* (${rangeLabel(range)})`,
    `Invoiced: ${kes(t.gross)} on ${t.invoices} invoice${t.invoices === 1 ? "" : "s"} (VAT ${kes(t.vat)})`,
    t.creditNotes ? `Credit notes: −${kes(t.returnsGross)} (${t.creditNotes})` : null,
    t.creditNotes ? `Net sales: ${kes(t.netGross)}` : null,
    `Money received: ${kes(money.total)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function payments(c: CommandContext, period: Period): Promise<string> {
  const range = periodRange(period, todayInNairobi(c.now));
  const m = await collections(c.db, range);
  const parts = (Object.entries(m.methodTotals) as [keyof typeof METHOD_LABELS, string][])
    .filter(([, v]) => !toDecimal(v).isZero())
    .map(([k, v]) => `${METHOD_LABELS[k]}: ${kes(v)}`);
  return [
    `*Money received ${PERIOD_LABEL[period]}* (${rangeLabel(range)})`,
    `${kes(m.total)} from ${m.count} payment${m.count === 1 ? "" : "s"}`,
    ...parts,
    toDecimal(m.reversed).greaterThan(0) ? `Reversed: ${kes(m.reversed)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function lowStock(c: CommandContext): Promise<string> {
  const { rows } = await stockLevels(c.db, c.actor, { lowOnly: true });
  if (!rows.length) return "Nothing is at or below its reorder level.";
  return (
    `*Low stock* (${rows.length})\n` +
    rows
      .slice(0, 15)
      .map(
        (r) =>
          `${r.sku} ${r.name}: ${formatQuantity(r.total, r)} (reorder at ${formatQuantity(r.reorderLevel, r)})`,
      )
      .join("\n") +
    more(rows.length, 15)
  );
}

async function owed(c: CommandContext): Promise<string> {
  const aged = await agedReceivables(c.db, c.actor, todayInNairobi(c.now));
  const rows = [...aged.rows].sort((a, b) => toDecimal(b.owed).comparedTo(a.owed));
  if (!rows.length) return "Nobody owes anything.";
  const total = rows.reduce((s, r) => s.plus(r.owed), toDecimal(0));
  const overdue = rows.reduce((s, r) => s.plus(r.owed).minus(r.buckets[0]!), toDecimal(0));
  return (
    [
      `*Owed by customers:* ${kes(total.toFixed(2))} (overdue ${kes(overdue.toFixed(2))})`,
      ...rows.slice(0, LIST_LIMIT).map((r) => {
        const od = toDecimal(r.owed).minus(r.buckets[0]!);
        return `${r.code} ${r.name}: ${kes(r.owed)}${od.greaterThan(0) ? `, ${kes(od.toFixed(2))} overdue` : ""}`;
      }),
    ].join("\n") + more(rows.length, LIST_LIMIT)
  );
}

async function invoice(c: CommandContext, number: string): Promise<string> {
  const d = await c.db.salesDocument.findFirst({
    where: { kind: "INVOICE", number },
    include: { customer: { select: { name: true, code: true } }, lines: { orderBy: { position: "asc" } } },
  });
  if (!d) return `There is no invoice ${number}.`;
  const due = d.total.minus(d.amountPaid).minus(d.amountCredited);
  return [
    `*${d.number}* — ${d.customer.name} (${d.customer.code})`,
    `Date: ${formatLongDay(fromDbDate(d.issueDate))}${d.dueDate ? `, due ${formatLongDay(fromDbDate(d.dueDate))}` : ""}`,
    ...d.lines
      .slice(0, 10)
      .map(
        (l) =>
          `${l.quantity} ${UNIT_LABELS[l.unit][l.quantity === 1 ? "one" : "many"]} ${l.description}: ${kes(l.grossAmount)}`,
      ),
    d.lines.length > 10 ? `…${d.lines.length - 10} more lines` : null,
    `Total: ${kes(d.total)}`,
    d.amountPaid.greaterThan(0) ? `Paid: ${kes(d.amountPaid)}` : null,
    d.amountCredited.greaterThan(0) ? `Credited: ${kes(d.amountCredited)}` : null,
    due.greaterThan(0) ? `Balance due: ${kes(due)}` : "Fully paid.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Confirmations ───────────────────────────────────────────────────

type PayPayload = {
  customerId: string;
  customerName: string;
  amount: string;
  method: "CASH" | "MPESA" | "BANK_TRANSFER" | "CHEQUE";
  reference: string | null;
  receivedOn: string;
  balanceAtRequest: string;
};
type SellPayload = { documentId: string; version: number; customerName: string; total: string };

async function cancelDraftQuietly(c: CommandContext, payload: Prisma.JsonValue, reason: string) {
  const p = payload as SellPayload;
  const doc = await c.db.salesDocument.findUnique({ where: { id: p.documentId } });
  if (doc && doc.status === "DRAFT" && doc.version === p.version) {
    await cancelDocument(c.db, c.actor, doc.id, { version: doc.version, reason }, c.audit).catch(
      () => undefined,
    );
  }
}

/** Mark this owner's lapsed requests EXPIRED (and drop their SELL drafts). Returns how many lapsed. */
async function expireStale(c: CommandContext): Promise<number> {
  const now = c.now ?? new Date();
  const stale = await c.db.whatsAppConfirmation.findMany({
    where: { userId: c.actor.id, status: "PENDING", expiresAt: { lte: now } },
  });
  for (const s of stale) {
    const { count } = await c.db.whatsAppConfirmation.updateMany({
      where: { id: s.id, status: "PENDING" },
      data: { status: "EXPIRED", resolvedAt: now },
    });
    if (count && s.action === "SELL") await cancelDraftQuietly(c, s.payload, "WhatsApp confirmation expired");
  }
  return stale.length;
}

async function cancelPending(c: CommandContext, reason: string): Promise<number> {
  const pending = await c.db.whatsAppConfirmation.findMany({
    where: { userId: c.actor.id, status: "PENDING" },
  });
  for (const p of pending) {
    const { count } = await c.db.whatsAppConfirmation.updateMany({
      where: { id: p.id, status: "PENDING" },
      data: { status: "CANCELLED", resolvedAt: new Date(), error: reason },
    });
    if (count && p.action === "SELL") await cancelDraftQuietly(c, p.payload, reason);
  }
  return pending.length;
}

async function askToConfirm(
  c: CommandContext,
  action: "PAY" | "SELL",
  payload: PayPayload | SellPayload,
  summary: string,
): Promise<string> {
  await expireStale(c);
  await cancelPending(c, "Replaced by a newer request");
  const id = randomUUID();
  const code = String(randomInt(100_000, 1_000_000));
  const now = c.now ?? new Date();
  await c.db.whatsAppConfirmation.create({
    data: {
      id,
      userId: c.actor.id,
      waNumber: c.waNumber,
      action,
      payload,
      summary,
      codeHash: hashCode(id, code),
      expiresAt: new Date(now.getTime() + CONFIRM_MINUTES * 60_000),
    },
  });
  return `${summary}\n\nReply *YES ${code}* within ${CONFIRM_MINUTES} minutes to confirm, or NO to cancel.`;
}

async function requestPayment(c: CommandContext, cmd: Extract<Command, { kind: "pay" }>): Promise<string> {
  const found = await findCustomer(c.db, c.actor, cmd.customer);
  if (!found.ok) return found.reply;
  const cu = found.value;
  if (cu.status !== "ACTIVE") return `${cu.name} is inactive. Reactivate them in the ERP first.`;
  if (cmd.reference) {
    const dup = await c.db.payment.findFirst({
      where: { method: cmd.method, reference: cmd.reference },
      select: { number: true },
    });
    if (dup) return `${cmd.reference} was already recorded on ${dup.number}. Nothing was changed.`;
  }
  const b = await customerBalance(c.db, cu.id);
  const after = toDecimal(b.balance).minus(cmd.amount);
  const payload: PayPayload = {
    customerId: cu.id,
    customerName: cu.name,
    amount: cmd.amount,
    method: cmd.method,
    reference: cmd.reference,
    receivedOn: todayInNairobi(c.now),
    balanceAtRequest: b.balance,
  };
  const summary = [
    `*Record payment?*`,
    `${kes(cmd.amount)} ${METHOD_LABELS[cmd.method]}${cmd.reference ? ` ${cmd.reference}` : ""}`,
    `From ${cu.name} (${cu.code}), received today`,
    `They ${owes(b.balance)} now; after this they ${owes(after.toFixed(2))}.`,
    `It goes to their oldest invoices first.`,
  ].join("\n");
  return askToConfirm(c, "PAY", payload, summary);
}

async function requestSale(c: CommandContext, cmd: Extract<Command, { kind: "sell" }>): Promise<string> {
  const found = await findCustomer(c.db, c.actor, cmd.customer);
  if (!found.ok) return found.reply;
  const cu = found.value;
  const warehouseId = await mainWarehouseId(c.db);
  if (!warehouseId) return "There is no active warehouse to sell from.";

  const lines: { line: SellLine; product: FoundProduct }[] = [];
  for (const line of cmd.lines) {
    const p = await findProduct(c.db, line.product);
    if (!p.ok) return p.reply;
    if (lines.some((l) => l.product.id === p.value.id && l.line.unit === line.unit)) {
      return `${p.value.name} in ${UNIT_LABELS[line.unit].many} is listed twice; put the total on one line.`;
    }
    lines.push({ line, product: p.value });
  }

  const draft = await createDraft(
    c.db,
    c.actor,
    "INVOICE",
    {
      customerId: cu.id,
      warehouseId,
      issueDate: todayInNairobi(c.now),
      notes: "Requested on WhatsApp",
      lines: lines.map((l) => ({ productId: l.product.id, unit: l.line.unit, quantity: l.line.quantity })),
    },
    c.audit,
  );
  const doc = await c.db.salesDocument.findUniqueOrThrow({
    where: { id: draft.id },
    include: { lines: { orderBy: { position: "asc" } } },
  });

  const free = await availability(c.db, warehouseId, [...new Set(doc.lines.map((l) => l.productId))]);
  const need = new Map<string, number>();
  for (const l of doc.lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.pieces);
  const short = [...need.entries()]
    .filter(([id, pieces]) => (free.get(id)?.available ?? 0) < pieces)
    .map(([id]) => doc.lines.find((l) => l.productId === id)!.description);

  const outstanding = (await customerBalance(c.db, cu.id)).balance;
  const credit = creditProblem({ creditLimit: cu.creditLimit, outstanding, amount: doc.total.toFixed(2) });

  const summary = [
    `*Post invoice for ${cu.name}?*`,
    ...doc.lines.map(
      (l) =>
        `${l.quantity} ${UNIT_LABELS[l.unit][l.quantity === 1 ? "one" : "many"]} ${l.description} @ ${kes(l.unitPrice)} = ${kes(l.grossAmount)}`,
    ),
    `Total ${kes(doc.total)} (VAT ${kes(doc.taxTotal)})`,
    short.length ? `⚠ Not enough stock for: ${short.join(", ")}. Posting will be refused.` : null,
    credit ? `⚠ ${credit} Posting will be refused; post it in the ERP with an override if you agree.` : null,
    `The draft is saved in the ERP; it is posted only when you confirm.`,
  ]
    .filter(Boolean)
    .join("\n");
  return askToConfirm(
    c,
    "SELL",
    { documentId: doc.id, version: doc.version, customerName: cu.name, total: doc.total.toFixed(2) },
    summary,
  );
}

async function confirm(c: CommandContext, code: string | null): Promise<string> {
  const lapsed = await expireStale(c);
  const pending = await c.db.whatsAppConfirmation.findFirst({
    where: { userId: c.actor.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) {
    return lapsed
      ? `That request expired after ${CONFIRM_MINUTES} minutes and nothing was changed. Send the command again.`
      : "There is nothing waiting for confirmation.";
  }
  if (!code) return "Reply YES followed by the 6-digit code from my last message, e.g. YES 482913.";
  if (hashCode(pending.id, code) !== pending.codeHash) {
    const attempts = pending.attempts + 1;
    if (attempts >= MAX_WRONG_CODES) {
      await c.db.whatsAppConfirmation.updateMany({
        where: { id: pending.id, status: "PENDING" },
        data: { attempts, status: "CANCELLED", resolvedAt: new Date(), error: "Too many wrong codes" },
      });
      if (pending.action === "SELL")
        await cancelDraftQuietly(c, pending.payload, "Too many wrong WhatsApp codes");
      return "That code was wrong three times, so the request is cancelled. Nothing was changed.";
    }
    await c.db.whatsAppConfirmation.update({ where: { id: pending.id }, data: { attempts } });
    return `That code doesn't match. Check my last message and try again (${MAX_WRONG_CODES - attempts} left).`;
  }

  // Claim it: only one reply can ever move it out of PENDING.
  const now = new Date();
  const claimed = await c.db.whatsAppConfirmation.updateMany({
    where: { id: pending.id, status: "PENDING", expiresAt: { gt: c.now ?? now } },
    data: { status: "CONFIRMED", resolvedAt: now },
  });
  if (!claimed.count) return "That request was already handled or has expired. Nothing more was changed.";

  try {
    let reply: string;
    let ref: string;
    if (pending.action === "PAY") {
      const p = pending.payload as PayPayload;
      const nowBalance = (await customerBalance(c.db, p.customerId)).balance;
      if (!toDecimal(nowBalance).equals(p.balanceAtRequest)) {
        throw new AppError(
          `${p.customerName}'s balance changed since you asked (${kes(p.balanceAtRequest)} → ${kes(nowBalance)}), so nothing was recorded. Send the PAY command again.`,
          "CONFLICT",
        );
      }
      const r = await recordPayment(
        c.db,
        c.actor,
        {
          customerId: p.customerId,
          receivedOn: p.receivedOn,
          method: p.method,
          reference: p.reference ?? undefined,
          amount: p.amount,
          notes: "Recorded on WhatsApp",
          idempotencyKey: pending.id,
          allocate: "auto",
        },
        c.audit,
      );
      const after = await customerBalance(c.db, p.customerId);
      ref = r.number;
      reply = `✅ ${r.number}: ${kes(p.amount)} from ${p.customerName} recorded. They now ${owes(after.balance)}.`;
    } else {
      const p = pending.payload as SellPayload;
      const r = await postInvoice(c.db, c.actor, p.documentId, { version: p.version }, c.audit);
      ref = r.number;
      reply = `✅ ${r.number} posted for ${p.customerName}: ${kes(p.total)}. Stock has been taken out.`;
    }
    await c.db.whatsAppConfirmation.update({ where: { id: pending.id }, data: { resultRef: ref } });
    await writeAudit(c.db, {
      actorUserId: c.actor.id,
      actorLabel: c.actor.email,
      action: "WHATSAPP_COMMAND_CONFIRMED",
      entityType: "WhatsAppConfirmation",
      entityId: pending.id,
      summary: `${pending.action} confirmed on WhatsApp: ${ref}`,
      metadata: { waNumber: c.waNumber, action: pending.action, result: ref },
      ...c.audit,
    });
    return reply;
  } catch (error) {
    const message = errorText(error);
    await c.db.whatsAppConfirmation.update({
      where: { id: pending.id },
      data: { status: "FAILED", error: message.slice(0, 1000) },
    });
    const keepDraft =
      pending.action === "SELL"
        ? "\nThe draft invoice is still in the ERP if you want to fix and post it there."
        : "";
    if (error instanceof AppError) return `Not done: ${message}${keepDraft}`;
    throw error;
  }
}

/** A readable message from a service error; field errors are joined. */
export function errorText(error: unknown): string {
  if (error instanceof ValidationError) {
    const msgs = Object.values(error.fieldErrors).flat();
    return msgs.length ? msgs.join(" ") : error.message;
  }
  if (error instanceof AppError) return error.message;
  return "Something went wrong and nothing was changed. Try again, or use the ERP.";
}

// ─── Entry point ─────────────────────────────────────────────────────

export async function runCommand(c: CommandContext, cmd: Command): Promise<string> {
  switch (cmd.kind) {
    case "help":
      return HELP_TEXT;
    case "usage":
      return cmd.message;
    case "unknown":
      return `I didn't understand "${cmd.text.slice(0, 60)}". Send HELP for the list of commands.`;
    case "stock":
      return stock(c, cmd.product);
    case "price":
      return price(c, cmd.product);
    case "products":
      return products(c, cmd.query);
    case "customers":
      return customers(c, cmd.query);
    case "balance":
      return balance(c, cmd.customer);
    case "statement":
      return statement(c, cmd.customer);
    case "sales":
      return sales(c, cmd.period);
    case "payments":
      return payments(c, cmd.period);
    case "lowStock":
      return lowStock(c);
    case "owed":
      return owed(c);
    case "invoice":
      return invoice(c, cmd.number);
    case "pay":
      return requestPayment(c, cmd);
    case "sell":
      return requestSale(c, cmd);
    case "confirm":
      return confirm(c, cmd.code);
    case "cancel": {
      await expireStale(c);
      const n = await cancelPending(c, "Cancelled by the owner on WhatsApp");
      return n ? "Cancelled. Nothing was changed." : "There was nothing waiting to cancel.";
    }
  }
}
