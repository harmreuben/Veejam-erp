import "server-only";

import { z } from "zod";

import {
  addDays,
  daysBetween,
  fromDbDate,
  startOfMonth,
  startOfPreviousMonth,
  todayInNairobi,
  toDbDate,
  type DayRange,
} from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import { authorize, hasPermission, type Actor } from "@/server/auth/permissions";
import type { Db, DbOrTx } from "@/server/db/client";
import { ValidationError } from "@/server/errors";

/**
 * Management reports. Every figure comes from posted documents or the journal,
 * so a report always agrees with the invoices, receipts and trial balance.
 * Money is returned as strings with two decimals (never JavaScript floats).
 *
 * Sales are counted on the invoice date and returns on the credit-note date.
 * Cost of goods sold is posted with each sale at weighted-average cost; stock
 * without a cost yet (opening stock not valued) sells at zero cost, which
 * the stock value report flags.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Read ?from=&to= with a default; refuses impossible ranges. */
export function readRange(
  sp: { from?: string; to?: string },
  fallback: DayRange = { from: startOfMonth(todayInNairobi()), to: todayInNairobi() },
): DayRange {
  const from = sp.from && day.safeParse(sp.from).success ? sp.from : fallback.from;
  const to = sp.to && day.safeParse(sp.to).success ? sp.to : fallback.to;
  if (from > to) throw new ValidationError({ from: ["The start date must be on or before the end date"] });
  if (daysBetween(from, to) > 3 * 366) {
    throw new ValidationError({ from: ["Choose at most three years at a time"] });
  }
  return { from, to };
}

const money = (v: string | null | undefined) => toDecimal(v ?? 0).toFixed(2);

// ─── Sales ──────────────────────────────────────────────────────────

export type SalesTotals = {
  invoices: number;
  net: string;
  vat: string;
  gross: string;
  creditNotes: number;
  returnsNet: string;
  returnsVat: string;
  returnsGross: string;
  /** Invoiced less credit notes, excluding VAT. */
  netSales: string;
  /** Invoiced less credit notes, including VAT. */
  netGross: string;
};

export async function salesTotals(db: DbOrTx, range: DayRange): Promise<SalesTotals> {
  const [row] = await db.$queryRaw<
    {
      invoices: number;
      inv_gross: string;
      inv_vat: string;
      credit_notes: number;
      cn_gross: string;
      cn_vat: string;
    }[]
  >`
    SELECT
      COUNT(*) FILTER (WHERE kind = 'INVOICE')::int AS invoices,
      COALESCE(SUM(total) FILTER (WHERE kind = 'INVOICE'), 0)::text AS inv_gross,
      COALESCE(SUM(tax_total) FILTER (WHERE kind = 'INVOICE'), 0)::text AS inv_vat,
      COUNT(*) FILTER (WHERE kind = 'CREDIT_NOTE')::int AS credit_notes,
      COALESCE(SUM(total) FILTER (WHERE kind = 'CREDIT_NOTE'), 0)::text AS cn_gross,
      COALESCE(SUM(tax_total) FILTER (WHERE kind = 'CREDIT_NOTE'), 0)::text AS cn_vat
    FROM sales_documents
    WHERE status = 'POSTED' AND kind IN ('INVOICE', 'CREDIT_NOTE')
      AND issue_date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}`;
  if (!row) throw new Error("No totals row");
  const gross = toDecimal(row.inv_gross);
  const vat = toDecimal(row.inv_vat);
  const rGross = toDecimal(row.cn_gross);
  const rVat = toDecimal(row.cn_vat);
  return {
    invoices: row.invoices,
    net: gross.minus(vat).toFixed(2),
    vat: vat.toFixed(2),
    gross: gross.toFixed(2),
    creditNotes: row.credit_notes,
    returnsNet: rGross.minus(rVat).toFixed(2),
    returnsVat: rVat.toFixed(2),
    returnsGross: rGross.toFixed(2),
    netSales: gross.minus(vat).minus(rGross.minus(rVat)).toFixed(2),
    netGross: gross.minus(rGross).toFixed(2),
  };
}

export type SalesGroup = "day" | "month" | "customer" | "product";
export const SALES_GROUPS: Record<SalesGroup, string> = {
  day: "Day",
  month: "Month",
  customer: "Customer",
  product: "Product",
};

export type SalesRow = {
  key: string;
  label: string;
  sub: string | null;
  href: string | null;
  documents: number;
  pieces: number | null;
  net: string;
  vat: string;
  gross: string;
  returnsGross: string;
  netGross: string;
};

/** Sales for a date range grouped by day, month, customer or product; credit notes subtracted. */
export async function salesReport(db: Db, actor: Actor, range: DayRange, group: SalesGroup) {
  authorize(actor, "reports.view");
  const from = toDbDate(range.from);
  const to = toDbDate(range.to);
  let rows: SalesRow[];

  if (group === "product") {
    const raw = await db.$queryRaw<
      {
        product_id: string;
        sku: string;
        name: string;
        docs: number;
        pieces: number;
        gross: string;
        vat: string;
        r_gross: string;
      }[]
    >`
      SELECT p.id AS product_id, p.sku, p.name,
        COUNT(DISTINCT d.id) FILTER (WHERE d.kind = 'INVOICE')::int AS docs,
        (COALESCE(SUM(l.pieces) FILTER (WHERE d.kind = 'INVOICE'), 0)
          - COALESCE(SUM(l.pieces) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0))::int AS pieces,
        COALESCE(SUM(l.gross_amount) FILTER (WHERE d.kind = 'INVOICE'), 0)::text AS gross,
        (COALESCE(SUM(l.tax_amount) FILTER (WHERE d.kind = 'INVOICE'), 0)
          - COALESCE(SUM(l.tax_amount) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0))::text AS vat,
        COALESCE(SUM(l.gross_amount) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0)::text AS r_gross
      FROM sales_document_lines l
      JOIN sales_documents d ON d.id = l.document_id
      JOIN products p ON p.id = l.product_id
      WHERE d.status = 'POSTED' AND d.kind IN ('INVOICE', 'CREDIT_NOTE')
        AND d.issue_date BETWEEN ${from} AND ${to}
      GROUP BY p.id, p.sku, p.name
      ORDER BY SUM(CASE WHEN d.kind = 'INVOICE' THEN l.gross_amount ELSE -l.gross_amount END) DESC, p.name`;
    rows = raw.map((r) => {
      const netGross = toDecimal(r.gross).minus(r.r_gross);
      return {
        key: r.product_id,
        label: r.name,
        sub: r.sku,
        href: `/products/${r.product_id}`,
        documents: r.docs,
        pieces: r.pieces,
        net: netGross.minus(r.vat).toFixed(2),
        vat: money(r.vat),
        gross: money(r.gross),
        returnsGross: money(r.r_gross),
        netGross: netGross.toFixed(2),
      };
    });
  } else {
    const key =
      group === "customer"
        ? "d.customer_id::text"
        : group === "month"
          ? "to_char(d.issue_date, 'YYYY-MM')"
          : "to_char(d.issue_date, 'YYYY-MM-DD')";
    // The grouping expression is one of three fixed strings above, never user input.
    const raw = await db.$queryRawUnsafe<
      {
        k: string;
        name: string | null;
        code: string | null;
        docs: number;
        gross: string;
        vat: string;
        r_gross: string;
        r_vat: string;
      }[]
    >(
      `SELECT ${key} AS k,
         MAX(c.name) AS name, MAX(c.code) AS code,
         COUNT(*) FILTER (WHERE d.kind = 'INVOICE')::int AS docs,
         COALESCE(SUM(d.total) FILTER (WHERE d.kind = 'INVOICE'), 0)::text AS gross,
         COALESCE(SUM(d.tax_total) FILTER (WHERE d.kind = 'INVOICE'), 0)::text AS vat,
         COALESCE(SUM(d.total) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0)::text AS r_gross,
         COALESCE(SUM(d.tax_total) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0)::text AS r_vat
       FROM sales_documents d JOIN customers c ON c.id = d.customer_id
       WHERE d.status = 'POSTED' AND d.kind IN ('INVOICE', 'CREDIT_NOTE')
         AND d.issue_date BETWEEN $1 AND $2
       GROUP BY 1
       ORDER BY ${group === "customer" ? "SUM(CASE WHEN d.kind = 'INVOICE' THEN d.total ELSE -d.total END) DESC" : "1"}`,
      from,
      to,
    );
    rows = raw.map((r) => {
      const netGross = toDecimal(r.gross).minus(r.r_gross);
      const vat = toDecimal(r.vat).minus(r.r_vat);
      return {
        key: r.k,
        label: group === "customer" ? (r.name ?? "") : r.k,
        sub: group === "customer" ? r.code : null,
        href: group === "customer" ? `/customers/${r.k}` : null,
        documents: r.docs,
        pieces: null,
        net: netGross.minus(vat).toFixed(2),
        vat: vat.toFixed(2),
        gross: money(r.gross),
        returnsGross: money(r.r_gross),
        netGross: netGross.toFixed(2),
      };
    });
  }
  return { rows, totals: await salesTotals(db, range) };
}

/** Daily sales and money received for the last `days` days, for the dashboard chart. */
export async function dailyTrend(db: DbOrTx, days: number, today = todayInNairobi()) {
  const from = addDays(today, -(days - 1));
  const [sales, receipts] = await Promise.all([
    db.$queryRaw<{ d: Date; gross: string }[]>`
      SELECT issue_date AS d,
        SUM(CASE WHEN kind = 'INVOICE' THEN total ELSE -total END)::text AS gross
      FROM sales_documents
      WHERE status = 'POSTED' AND kind IN ('INVOICE', 'CREDIT_NOTE')
        AND issue_date BETWEEN ${toDbDate(from)} AND ${toDbDate(today)}
      GROUP BY issue_date`,
    db.$queryRaw<{ d: Date; amount: string }[]>`
      SELECT received_on AS d, SUM(amount)::text AS amount
      FROM payments WHERE status = 'POSTED'
        AND received_on BETWEEN ${toDbDate(from)} AND ${toDbDate(today)}
      GROUP BY received_on`,
  ]);
  const s = new Map(sales.map((r) => [fromDbDate(r.d), r.gross]));
  const p = new Map(receipts.map((r) => [fromDbDate(r.d), r.amount]));
  return Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    return { day: d, sales: money(s.get(d)), received: money(p.get(d)) };
  });
}

// ─── VAT ────────────────────────────────────────────────────────────

/** Output VAT by month and rate: invoices less credit notes; input VAT from supplier bills. */
export async function vatReport(db: Db, actor: Actor, range: DayRange) {
  authorize(actor, "reports.view");
  const raw = await db.$queryRaw<
    {
      month: string;
      category: string;
      rate: string;
      net: string;
      vat: string;
      r_net: string;
      r_vat: string;
    }[]
  >`
    SELECT to_char(d.issue_date, 'YYYY-MM') AS month, l.tax_category::text AS category, l.tax_rate::text AS rate,
      COALESCE(SUM(l.gross_amount - l.tax_amount) FILTER (WHERE d.kind = 'INVOICE'), 0)::text AS net,
      COALESCE(SUM(l.tax_amount) FILTER (WHERE d.kind = 'INVOICE'), 0)::text AS vat,
      COALESCE(SUM(l.gross_amount - l.tax_amount) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0)::text AS r_net,
      COALESCE(SUM(l.tax_amount) FILTER (WHERE d.kind = 'CREDIT_NOTE'), 0)::text AS r_vat
    FROM sales_document_lines l JOIN sales_documents d ON d.id = l.document_id
    WHERE d.status = 'POSTED' AND d.kind IN ('INVOICE', 'CREDIT_NOTE')
      AND d.issue_date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}
    GROUP BY 1, 2, 3
    ORDER BY 1, 3 DESC, 2`;
  const rows = raw.map((r) => ({
    month: r.month,
    category: r.category,
    rate: toDecimal(r.rate).toDecimalPlaces(2).toString(),
    salesNet: money(r.net),
    salesVat: money(r.vat),
    returnsNet: money(r.r_net),
    returnsVat: money(r.r_vat),
    netVat: toDecimal(r.vat).minus(r.r_vat).toFixed(2),
  }));
  const sum = (k: "salesNet" | "salesVat" | "returnsNet" | "returnsVat" | "netVat") =>
    rows.reduce((s, r) => s.plus(r[k]), toDecimal(0)).toFixed(2);
  // Input VAT: on supplier bills, by bill date.
  const bills = await db.$queryRaw<{ month: string; net: string; vat: string }[]>`
    SELECT to_char(bill_date, 'YYYY-MM') AS month, SUM(subtotal)::text AS net, SUM(tax_total)::text AS vat
      FROM supplier_bills
     WHERE status = 'POSTED' AND bill_date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}
     GROUP BY 1 ORDER BY 1`;
  const inputRows = bills.map((b) => ({ month: b.month, net: money(b.net), vat: money(b.vat) }));
  const inputVat = inputRows.reduce((s, r) => s.plus(r.vat), toDecimal(0));
  return {
    rows,
    input: {
      rows: inputRows,
      net: inputRows.reduce((s, r) => s.plus(r.net), toDecimal(0)).toFixed(2),
      vat: inputVat.toFixed(2),
    },
    /** Output VAT less input VAT: what would be paid to KRA (negative: a credit). */
    payable: toDecimal(sum("netVat")).minus(inputVat).toFixed(2),
    totals: {
      salesNet: sum("salesNet"),
      salesVat: sum("salesVat"),
      returnsNet: sum("returnsNet"),
      returnsVat: sum("returnsVat"),
      netVat: sum("netVat"),
    },
  };
}

// ─── Money received ─────────────────────────────────────────────────

export async function collectionsReport(db: Db, actor: Actor, range: DayRange) {
  authorize(actor, "reports.view");
  return collections(db, range);
}

export async function collections(db: DbOrTx, range: DayRange) {
  const raw = await db.$queryRaw<{ d: Date; method: string; n: number; amount: string; reversed: string }[]>`
    SELECT received_on AS d, method::text AS method,
      COUNT(*) FILTER (WHERE status = 'POSTED')::int AS n,
      COALESCE(SUM(amount) FILTER (WHERE status = 'POSTED'), 0)::text AS amount,
      COALESCE(SUM(amount) FILTER (WHERE status = 'REVERSED'), 0)::text AS reversed
    FROM payments
    WHERE received_on BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}
    GROUP BY 1, 2 ORDER BY 1, 2`;
  const methods = ["CASH", "MPESA", "BANK_TRANSFER", "CHEQUE"] as const;
  const byDay = new Map<
    string,
    { day: string; byMethod: Record<string, string>; total: string; count: number }
  >();
  const methodTotals: Record<string, ReturnType<typeof toDecimal>> = Object.fromEntries(
    methods.map((m) => [m, toDecimal(0)]),
  );
  let reversed = toDecimal(0);
  let count = 0;
  for (const r of raw) {
    const d = fromDbDate(r.d);
    const row = byDay.get(d) ?? {
      day: d,
      byMethod: Object.fromEntries(methods.map((m) => [m, "0.00"])),
      total: "0.00",
      count: 0,
    };
    row.byMethod[r.method] = money(r.amount);
    row.total = toDecimal(row.total).plus(r.amount).toFixed(2);
    row.count += r.n;
    byDay.set(d, row);
    methodTotals[r.method] = methodTotals[r.method]!.plus(r.amount);
    reversed = reversed.plus(r.reversed);
    count += r.n;
  }
  const total = Object.values(methodTotals).reduce((s, v) => s.plus(v), toDecimal(0));
  return {
    rows: [...byDay.values()].filter((r) => r.count > 0),
    methodTotals: Object.fromEntries(
      Object.entries(methodTotals).map(([k, v]) => [k, v.toFixed(2)]),
    ) as Record<(typeof methods)[number], string>,
    total: total.toFixed(2),
    count,
    reversed: reversed.toFixed(2),
  };
}

// ─── Profit and loss (from the journal) ─────────────────────────────

export async function profitAndLoss(db: Db, actor: Actor, range: DayRange) {
  authorize(actor, "reports.view");
  const raw = await db.$queryRaw<
    { code: string; name: string; type: string; debit: string; credit: string }[]
  >`
    SELECT a.code, a.name, a.type::text AS type,
      COALESCE(SUM(l.debit), 0)::text AS debit, COALESCE(SUM(l.credit), 0)::text AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE a.type IN ('INCOME', 'EXPENSE') AND e.date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}
    GROUP BY a.code, a.name, a.type
    ORDER BY a.code`;
  const income = raw
    .filter((r) => r.type === "INCOME")
    .map((r) => ({ code: r.code, name: r.name, amount: toDecimal(r.credit).minus(r.debit).toFixed(2) }));
  const expenses = raw
    .filter((r) => r.type === "EXPENSE")
    .map((r) => ({ code: r.code, name: r.name, amount: toDecimal(r.debit).minus(r.credit).toFixed(2) }));
  const totalIncome = income.reduce((s, r) => s.plus(r.amount), toDecimal(0));
  const totalExpenses = expenses.reduce((s, r) => s.plus(r.amount), toDecimal(0));
  const cogsPosted = expenses.some((r) => r.code === "5000" && !toDecimal(r.amount).isZero());
  return {
    income,
    expenses,
    totalIncome: totalIncome.toFixed(2),
    totalExpenses: totalExpenses.toFixed(2),
    result: totalIncome.minus(totalExpenses).toFixed(2),
    cogsPosted,
  };
}

// ─── Stock value ────────────────────────────────────────────────────

/**
 * Stock on hand at what it cost: each product's weighted-average stock value
 * (kept by every receipt, sale, return and adjustment). Products with stock
 * but no cost yet (e.g. opening stock from the old system) are counted as
 * missing, not guessed.
 */
export async function stockValuation(db: Db, actor: Actor) {
  authorize(actor, "reports.view");
  authorize(actor, "catalogue.costs");
  const products = await db.product.findMany({
    where: { OR: [{ status: "ACTIVE" }, { balances: { some: { quantity: { not: 0 } } } }] },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
    select: {
      id: true,
      sku: true,
      name: true,
      brand: true,
      unitsPerPack: true,
      packsPerCarton: true,
      costPrice: true,
      balances: { select: { quantity: true } },
      valuation: { select: { value: true } },
    },
  });
  let total = toDecimal(0);
  let missing = 0;
  const rows = products.map((p) => {
    const pieces = p.balances.reduce((s, b) => s + b.quantity, 0);
    const stored = pieces > 0 ? (p.valuation?.value ?? toDecimal(0)) : toDecimal(0);
    const costed = pieces === 0 || stored.greaterThan(0);
    if (!costed) missing += 1;
    total = total.plus(stored);
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand,
      sizes: { unitsPerPack: p.unitsPerPack, packsPerCarton: p.packsPerCarton },
      pieces,
      /** Average cost of one piece on hand (4 decimals), or null without stock or cost. */
      averageCost: pieces > 0 && costed ? stored.dividedBy(pieces).toDecimalPlaces(4).toFixed(4) : null,
      /** Latest purchase cost per piece, a hint for setting an opening cost. */
      costPrice: p.costPrice?.toFixed(2) ?? null,
      value: costed ? stored.toFixed(2) : null,
    };
  });
  return { rows, total: total.toFixed(2), missing };
}

// ─── Dashboard ──────────────────────────────────────────────────────

export async function dashboard(db: Db, actor: Actor, today = todayInNairobi()) {
  authorize(actor, "reports.view");
  const monthStart = startOfMonth(today);
  const prevStart = startOfPreviousMonth(today);
  // Same number of days into last month, so "vs last month" compares like with like.
  const dayOfMonth = Number(today.slice(8, 10));
  const prevSameDay = addDays(prevStart, Math.min(dayOfMonth, daysBetween(prevStart, monthStart)) - 1);

  const [
    todaySales,
    monthSales,
    prevMonthSales,
    monthIn,
    trend,
    receivables,
    lowStock,
    topCustomers,
    topProducts,
  ] = await Promise.all([
    salesTotals(db, { from: today, to: today }),
    salesTotals(db, { from: monthStart, to: today }),
    salesTotals(db, { from: prevStart, to: prevSameDay }),
    collections(db, { from: monthStart, to: today }),
    dailyTrend(db, 30, today),
    db.$queryRaw<{ owed: string; overdue: string; customers: number }[]>`
        SELECT COALESCE(SUM(total - amount_paid - amount_credited), 0)::text AS owed,
          COALESCE(SUM(total - amount_paid - amount_credited)
            FILTER (WHERE COALESCE(due_date, issue_date) < ${toDbDate(today)}), 0)::text AS overdue,
          COUNT(DISTINCT customer_id) FILTER (WHERE total - amount_paid - amount_credited > 0)::int AS customers
        FROM sales_documents WHERE kind = 'INVOICE' AND status = 'POSTED'`,
    db.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM products p
        WHERE p.status = 'ACTIVE'
          AND COALESCE((SELECT SUM(quantity) FROM stock_balances b WHERE b.product_id = p.id), 0) <= p.reorder_level`,
    salesReport(db, actor, { from: monthStart, to: today }, "customer"),
    salesReport(db, actor, { from: monthStart, to: today }, "product"),
  ]);
  const r = receivables[0]!;
  const stock = hasPermission(actor, "catalogue.costs") ? await stockValuation(db, actor) : null;
  const ageing = hasPermission(actor, "customers.view") ? await ageingTotals(db, today) : null;
  return {
    today,
    todaySales,
    monthSales,
    prevMonthSales,
    monthReceived: monthIn.total,
    trend,
    owed: money(r.owed),
    overdue: money(r.overdue),
    customersOwing: r.customers,
    lowStock: lowStock[0]?.n ?? 0,
    stockValue: stock ? { total: stock.total, missing: stock.missing } : null,
    ageing,
    topCustomers: topCustomers.rows.slice(0, 5),
    topProducts: topProducts.rows.slice(0, 5),
  };
}

/** Labels match the customer balances page (payments/service.ts agedReceivables). */
export const AGE_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

/**
 * Everything customers owe on posted invoices, split by how many days past the
 * due date (or the issue date, without one) each invoice is.
 */
export async function ageingTotals(db: DbOrTx, asOf: string) {
  const [r] = await db.$queryRaw<{ b0: string; b1: string; b2: string; b3: string; b4: string }[]>`
    WITH open AS (
      SELECT total - amount_paid - amount_credited AS out,
        ${toDbDate(asOf)}::date - COALESCE(due_date, issue_date) AS late
      FROM sales_documents
      WHERE kind = 'INVOICE' AND status = 'POSTED' AND total - amount_paid - amount_credited > 0
    )
    SELECT
      COALESCE(SUM(out) FILTER (WHERE late <= 0), 0)::text AS b0,
      COALESCE(SUM(out) FILTER (WHERE late BETWEEN 1 AND 30), 0)::text AS b1,
      COALESCE(SUM(out) FILTER (WHERE late BETWEEN 31 AND 60), 0)::text AS b2,
      COALESCE(SUM(out) FILTER (WHERE late BETWEEN 61 AND 90), 0)::text AS b3,
      COALESCE(SUM(out) FILTER (WHERE late > 90), 0)::text AS b4
    FROM open`;
  return { buckets: AGE_BUCKETS, totals: [r!.b0, r!.b1, r!.b2, r!.b3, r!.b4].map(money) };
}

// ─── A salesperson's own dashboard ──────────────────────────────────

/**
 * One person's own selling: invoices they wrote (posted, VAT-inclusive) less
 * credit notes raised against those invoices, money they recorded, their open
 * quotes and orders, and their customers' overdue invoices to chase.
 * Old-system invoices are left out. No costs or profit.
 */
export async function myDashboard(db: Db, actor: Actor, today = todayInNairobi()) {
  authorize(actor, "dashboard.own");
  const me = actor.id;
  const monthStart = startOfMonth(today);
  const prevStart = startOfPreviousMonth(today);
  const dayOfMonth = Number(today.slice(8, 10));
  const prevSameDay = addDays(prevStart, Math.min(dayOfMonth, daysBetween(prevStart, monthStart)) - 1);
  const from30 = addDays(today, -29);

  const mySales = async (range: DayRange) => {
    const [row] = await db.$queryRaw<{ invoices: number; gross: string; credited: string }[]>`
      SELECT
        (SELECT COUNT(*)::int FROM sales_documents
          WHERE kind = 'INVOICE' AND status = 'POSTED' AND NOT historical AND created_by_id = ${me}::uuid
            AND issue_date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}) AS invoices,
        (SELECT COALESCE(SUM(total), 0)::text FROM sales_documents
          WHERE kind = 'INVOICE' AND status = 'POSTED' AND NOT historical AND created_by_id = ${me}::uuid
            AND issue_date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}) AS gross,
        (SELECT COALESCE(SUM(cn.total), 0)::text FROM sales_documents cn
          JOIN sales_documents inv ON inv.id = cn.source_document_id
          WHERE cn.kind = 'CREDIT_NOTE' AND cn.status = 'POSTED' AND inv.created_by_id = ${me}::uuid
            AND cn.issue_date BETWEEN ${toDbDate(range.from)} AND ${toDbDate(range.to)}) AS credited`;
    return { invoices: row!.invoices, netGross: toDecimal(row!.gross).minus(row!.credited).toFixed(2) };
  };

  const [
    today_,
    month,
    prevMonth,
    received,
    trendSales,
    trendReceived,
    open,
    chase,
    topProducts,
    topCustomers,
  ] = await Promise.all([
    mySales({ from: today, to: today }),
    mySales({ from: monthStart, to: today }),
    mySales({ from: prevStart, to: prevSameDay }),
    db.$queryRaw<{ amount: string; n: number }[]>`
        SELECT COALESCE(SUM(amount), 0)::text AS amount, COUNT(*)::int AS n FROM payments
        WHERE status = 'POSTED' AND received_by_id = ${me}::uuid
          AND received_on BETWEEN ${toDbDate(monthStart)} AND ${toDbDate(today)}`,
    db.$queryRaw<{ d: Date; gross: string }[]>`
        SELECT d, SUM(gross)::text AS gross FROM (
          SELECT issue_date AS d, total AS gross FROM sales_documents
           WHERE kind = 'INVOICE' AND status = 'POSTED' AND NOT historical AND created_by_id = ${me}::uuid
             AND issue_date BETWEEN ${toDbDate(from30)} AND ${toDbDate(today)}
          UNION ALL
          SELECT cn.issue_date, -cn.total FROM sales_documents cn
            JOIN sales_documents inv ON inv.id = cn.source_document_id
           WHERE cn.kind = 'CREDIT_NOTE' AND cn.status = 'POSTED' AND inv.created_by_id = ${me}::uuid
             AND cn.issue_date BETWEEN ${toDbDate(from30)} AND ${toDbDate(today)}
        ) x GROUP BY d`,
    db.$queryRaw<{ d: Date; amount: string }[]>`
        SELECT received_on AS d, SUM(amount)::text AS amount FROM payments
        WHERE status = 'POSTED' AND received_by_id = ${me}::uuid
          AND received_on BETWEEN ${toDbDate(from30)} AND ${toDbDate(today)}
        GROUP BY received_on`,
    db.$queryRaw<
      { quotes: number; quotes_value: string; orders: number; orders_value: string; drafts: number }[]
    >`
        SELECT
          COUNT(*) FILTER (WHERE kind = 'QUOTATION' AND status IN ('DRAFT', 'SENT', 'ACCEPTED'))::int AS quotes,
          COALESCE(SUM(total) FILTER (WHERE kind = 'QUOTATION' AND status IN ('DRAFT', 'SENT', 'ACCEPTED')), 0)::text AS quotes_value,
          COUNT(*) FILTER (WHERE kind = 'SALES_ORDER' AND status IN ('DRAFT', 'CONFIRMED'))::int AS orders,
          COALESCE(SUM(total) FILTER (WHERE kind = 'SALES_ORDER' AND status IN ('DRAFT', 'CONFIRMED')), 0)::text AS orders_value,
          COUNT(*) FILTER (WHERE kind = 'INVOICE' AND status = 'DRAFT')::int AS drafts
        FROM sales_documents WHERE created_by_id = ${me}::uuid`,
    db.$queryRaw<
      {
        id: string;
        number: string;
        customer_id: string;
        customer: string;
        due: Date;
        balance: string;
        all_count: number;
        all_total: string;
      }[]
    >`
        SELECT d.id, d.number, c.id AS customer_id, c.name AS customer, COALESCE(d.due_date, d.issue_date) AS due,
               (d.total - d.amount_paid - d.amount_credited)::text AS balance,
               (COUNT(*) OVER ())::int AS all_count,
               (SUM(d.total - d.amount_paid - d.amount_credited) OVER ())::text AS all_total
        FROM sales_documents d JOIN customers c ON c.id = d.customer_id
        WHERE d.kind = 'INVOICE' AND d.status = 'POSTED' AND d.created_by_id = ${me}::uuid
          AND d.total - d.amount_paid - d.amount_credited > 0
          AND COALESCE(d.due_date, d.issue_date) < ${toDbDate(today)}
        ORDER BY COALESCE(d.due_date, d.issue_date), d.number
        LIMIT 10`,
    db.$queryRaw<{ name: string; sku: string; gross: string; invoices: number }[]>`
        SELECT l.description AS name, l.sku, SUM(l.gross_amount)::text AS gross, COUNT(DISTINCT d.id)::int AS invoices
        FROM sales_document_lines l JOIN sales_documents d ON d.id = l.document_id
        WHERE d.kind = 'INVOICE' AND d.status = 'POSTED' AND NOT d.historical AND d.created_by_id = ${me}::uuid
          AND d.issue_date BETWEEN ${toDbDate(monthStart)} AND ${toDbDate(today)}
        GROUP BY l.description, l.sku ORDER BY SUM(l.gross_amount) DESC LIMIT 5`,
    db.$queryRaw<{ id: string; name: string; gross: string; invoices: number }[]>`
        SELECT c.id, c.name, SUM(d.total)::text AS gross, COUNT(*)::int AS invoices
        FROM sales_documents d JOIN customers c ON c.id = d.customer_id
        WHERE d.kind = 'INVOICE' AND d.status = 'POSTED' AND NOT d.historical AND d.created_by_id = ${me}::uuid
          AND d.issue_date BETWEEN ${toDbDate(monthStart)} AND ${toDbDate(today)}
        GROUP BY c.id, c.name ORDER BY SUM(d.total) DESC LIMIT 5`,
  ]);

  const s = new Map(trendSales.map((r) => [fromDbDate(r.d), r.gross]));
  const p = new Map(trendReceived.map((r) => [fromDbDate(r.d), r.amount]));
  const o = open[0]!;
  return {
    today,
    todaySales: today_,
    monthSales: month,
    prevMonthSales: prevMonth,
    monthReceived: money(received[0]?.amount),
    paymentsRecorded: received[0]?.n ?? 0,
    trend: Array.from({ length: 30 }, (_, i) => {
      const d = addDays(from30, i);
      return { day: d, sales: money(s.get(d)), received: money(p.get(d)) };
    }),
    open: {
      quotes: o.quotes,
      quotesValue: money(o.quotes_value),
      orders: o.orders,
      ordersValue: money(o.orders_value),
      draftInvoices: o.drafts,
    },
    toChase: chase.map((c) => ({
      id: c.id,
      number: c.number,
      customerId: c.customer_id,
      customer: c.customer,
      due: fromDbDate(c.due),
      daysOverdue: daysBetween(fromDbDate(c.due), today),
      balance: money(c.balance),
    })),
    overdueCount: chase[0]?.all_count ?? 0,
    overdueTotal: money(chase[0]?.all_total),
    topProducts: topProducts.map((r) => ({ ...r, gross: money(r.gross) })),
    topCustomers: topCustomers.map((r) => ({ ...r, gross: money(r.gross) })),
  };
}
