/**
 * Turns the old system's nine CSV exports into a plan: the customers, products,
 * prices and historical invoices to create, plus every problem found. Pure
 * functions, no database, so the plan can be reviewed (and tested) before
 * anything is written.
 */

import type { CustomerType } from "@/generated/prisma/enums";
import { todayInNairobi } from "@/lib/dates";
import { formatKES, roundMoney, toDecimal } from "@/lib/money";
import { normalizeKenyanPhone } from "@/lib/phone";
import { calculateLine } from "@/lib/sales-math";

import {
  AMOUNT_PAID_SOURCE,
  CUSTOMER_GROUPS,
  DEMO_CUSTOMERS,
  OLD_VAT_RATE,
  PACK_SIZE_SOURCE,
  VAT_ON_TOP_CORRECTIONS,
} from "./decisions";

export type LegacyRows = Partial<Record<string, Record<string, string>[]>>;

export type PlannedProduct = {
  sku: string;
  name: string;
  category: string;
  unitsPerPack: number;
  packsPerCarton: number;
  reorderLevel: number;
  retailPack: string;
  wholesalePack: string;
  wholesaleCarton: string;
};

export type PlannedCustomer = {
  name: string;
  type: CustomerType;
  phone: string | null;
  legacyNames: string[];
  wholesale: boolean;
  invoices: number;
  outstanding: string;
  note?: string;
};

export type PlannedLine = {
  sku: string;
  quantity: number;
  unitPrice: string;
  netAmount: string;
  taxAmount: string;
  grossAmount: string;
};

export type PlannedInvoice = {
  number: string;
  customer: string;
  oldCustomerName: string;
  postedAt: Date;
  issueDay: string;
  lines: PlannedLine[];
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  amountPaid: string;
  createdBy: string;
  correction: string | null;
};

export type PlannedStock = {
  sku: string;
  /** Packets on hand in the old system, and the same in pieces. */
  packs: number;
  pieces: number;
  cartons: number;
  loose: number;
};

export type Problem = { level: "error" | "warning" | "info"; topic: string; message: string };

export type LegacyPlan = {
  products: PlannedProduct[];
  customers: PlannedCustomer[];
  invoices: PlannedInvoice[];
  /** Opening stock from the inventory report, if that file is present. */
  openingStock: PlannedStock[];
  problems: Problem[];
  totals: { invoiced: string; paid: string; outstanding: string };
  oldTotals: { invoiced: string; paid: string; outstanding: string };
  defaults: string[];
};

export const nameKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const cleanText = (s: string) => s.replace(/`/g, "'").replace(/\s+/g, " ").trim();

const money = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : roundMoney(t);
};

/** "2026-07-08T04:42:48.754000" (UTC) → Date. */
const utc = (s: string) => new Date(`${s.replace(/(\.\d{3})\d*/, "$1")}${/Z$/.test(s) ? "" : "Z"}`);

export function buildLegacyPlan(files: LegacyRows): LegacyPlan {
  const problems: Problem[] = [];
  const need = (kind: string) => {
    const rows = files[kind];
    if (!rows) problems.push({ level: "error", topic: "Files", message: `${kind} export is missing` });
    return rows ?? [];
  };
  const productRows = need("products-inventory");
  // The separate price list export, when present, is the source for prices.
  const priceRows = new Map((files["price-lists"] ?? []).map((r) => [r.sku!.trim().toUpperCase(), r]));
  const customerRows = need("customers");
  const invoiceRows = need("invoices");
  const lineRows = need("invoice-line-items");
  const paymentRows = files["payments"] ?? [];

  // ── Products ───────────────────────────────────────────────────
  const products: PlannedProduct[] = productRows.map((r) => {
    const sku = r.sku!.trim().toUpperCase();
    const perPack = Number(r.pack_size);
    const perCarton = Number(r.units_per_case);
    if (!Number.isInteger(perPack) || perPack < 1 || !Number.isInteger(perCarton) || perCarton < 1) {
      problems.push({
        level: "error",
        topic: "Products",
        message: `${sku}: pack sizes are not whole numbers`,
      });
    }
    const pr = priceRows.get(sku);
    const retail = money(pr?.retail_unit_price) ?? money(r.unit_price) ?? toDecimal(0);
    const wholesale = money(pr?.wholesale_price) ?? money(r.wholesale_price) ?? retail;
    if (pr && Number(pr.units_per_case) !== perCarton) {
      problems.push({
        level: "warning",
        topic: "Products",
        message: `${sku}: the price list says ${pr.units_per_case} packets per carton, the product list ${perCarton}; the product list is used`,
      });
    }
    return {
      sku,
      name: cleanText(r.name!),
      category: cleanText(r.category!),
      unitsPerPack: perPack,
      packsPerCarton: perCarton,
      reorderLevel: Math.max(0, Number(r.reorder_level) || 0) * perPack,
      retailPack: retail.toFixed(2),
      wholesalePack: wholesale.toFixed(2),
      wholesaleCarton: wholesale.times(perCarton).toFixed(2),
    };
  });
  const productBySku = new Map(products.map((p) => [p.sku, p]));
  if (products.some((p) => /boublemint/i.test(p.name))) {
    problems.push({
      level: "info",
      topic: "Products",
      message: `"Orbit 10's Boublemint" is kept as spelled in the old system. Rename it under Products if it should read Bubblemint.`,
    });
  }

  // ── Opening stock from the inventory report ────────────────────
  const openingStock: PlannedStock[] = [];
  for (const r of files["inventory-report"] ?? []) {
    const sku = r.sku!.trim().toUpperCase();
    const p = productBySku.get(sku);
    if (!p) {
      problems.push({ level: "error", topic: "Stock", message: `Inventory report: unknown product ${sku}` });
      continue;
    }
    const packs = Number(r.total_units);
    const cartons = Number(r.cases);
    const loose = Number(r.loose);
    if (!Number.isInteger(packs) || packs < 0) {
      problems.push({
        level: "error",
        topic: "Stock",
        message: `${sku}: stock "${r.total_units}" is not a whole number`,
      });
      continue;
    }
    if (cartons * p.packsPerCarton + loose !== packs) {
      problems.push({
        level: "warning",
        topic: "Stock",
        message: `${sku}: ${cartons} cartons + ${loose} packets doesn't equal ${packs} packets; ${packs} is used`,
      });
    }
    if (packs > 0) openingStock.push({ sku, packs, pieces: packs * p.unitsPerPack, cartons, loose });
  }
  if (openingStock.length) {
    problems.push({
      level: "info",
      topic: "Stock",
      message:
        "Opening stock is taken from the old system's inventory report, whose figures didn't always follow the sales (see DATA_MIGRATION.md). Do a stock count soon to confirm them.",
    });
  }

  // ── Customers ──────────────────────────────────────────────────
  const groupOf = new Map<string, (typeof CUSTOMER_GROUPS)[number]>();
  for (const g of CUSTOMER_GROUPS) for (const n of g.oldNames) groupOf.set(nameKey(n), g);
  const demo = new Set(DEMO_CUSTOMERS.names.map(nameKey));

  const unmatched = new Set<string>();
  const resolve = (oldName: string): string | null => {
    const key = nameKey(oldName);
    if (demo.has(key)) return null;
    const g = groupOf.get(key);
    if (!g) unmatched.add(oldName.trim());
    return g?.name ?? null;
  };

  const phones = new Map<string, string>();
  for (const r of customerRows) {
    const target = resolve(r.name!);
    const phone = normalizeKenyanPhone(r.phone ?? "");
    if (target && phone && !phones.has(target)) phones.set(target, phone);
  }

  // ── Invoices ───────────────────────────────────────────────────
  const linesByInvoice = new Map<string, Record<string, string>[]>();
  for (const l of lineRows) {
    const list = linesByInvoice.get(l.invoice_number!) ?? [];
    list.push(l);
    linesByInvoice.set(l.invoice_number!, list);
  }

  const invoices: PlannedInvoice[] = [];
  let oldInvoiced = toDecimal(0);
  let oldPaid = toDecimal(0);
  let oldBalance = toDecimal(0);
  for (const r of invoiceRows) {
    const number = r.invoice_number!.trim();
    const oldTotal = money(r.total_amount) ?? toDecimal(0);
    oldInvoiced = oldInvoiced.plus(oldTotal);
    oldPaid = oldPaid.plus(money(r.amount_paid) ?? 0);
    oldBalance = oldBalance.plus(money(r.balance) ?? 0);

    const customer = resolve(r.customer_name!);
    if (!customer) {
      problems.push({
        level: "warning",
        topic: "Invoices",
        message: `${number} is for "${r.customer_name!.trim()}", which is not being imported; the invoice is skipped`,
      });
      continue;
    }

    const lines: PlannedLine[] = [];
    for (const l of linesByInvoice.get(number) ?? []) {
      const sku = l.sku!.trim().toUpperCase();
      const quantity = Number(l.quantity);
      if (quantity === 0) continue; // the old system saved empty lines
      if (!productBySku.has(sku)) {
        problems.push({ level: "error", topic: "Invoices", message: `${number}: unknown product ${sku}` });
        continue;
      }
      const price = money(l.unit_price)!;
      const gross = money(l.line_total)!;
      if (!price.times(quantity).equals(gross)) {
        problems.push({
          level: "warning",
          topic: "Invoices",
          message: `${number} ${sku}: ${quantity} × ${price.toFixed(2)} ≠ line total ${gross.toFixed(2)}; the line total is kept`,
        });
      }
      const t = calculateLine({ quantity: 1, unitPrice: gross.toFixed(2), taxRate: OLD_VAT_RATE }, true);
      lines.push({
        sku,
        quantity,
        unitPrice: price.toFixed(2),
        netAmount: t.netAmount,
        taxAmount: t.taxAmount,
        grossAmount: t.grossAmount,
      });
    }
    if (!lines.length) {
      problems.push({ level: "error", topic: "Invoices", message: `${number} has no line items` });
      continue;
    }

    const linesTotal = lines.reduce((s, l) => s.plus(l.grossAmount), toDecimal(0));
    let total = oldTotal;
    let correction: string | null = null;
    const fix = VAT_ON_TOP_CORRECTIONS[number];
    if (fix) {
      total = toDecimal(fix.total);
      correction = `Total corrected from ${formatKES(oldTotal)} to ${formatKES(total)}: the old system added VAT on top of VAT-inclusive prices.`;
    }
    const discount = linesTotal.minus(total);
    if (discount.isNegative()) {
      problems.push({
        level: "error",
        topic: "Invoices",
        message: `${number}: total ${formatKES(total)} is more than its lines (${formatKES(linesTotal)})`,
      });
      continue;
    }
    const tax = roundMoney(total.times(OLD_VAT_RATE).dividedBy(toDecimal(OLD_VAT_RATE).plus(100)));
    const oldPaidHere = money(r.amount_paid) ?? toDecimal(0);
    const paid = oldPaidHere.greaterThan(total) ? total : oldPaidHere;
    if (oldPaidHere.greaterThan(total)) {
      problems.push({
        level: "warning",
        topic: "Payments",
        message: `${number}: the old system shows ${formatKES(oldPaidHere)} paid on a ${formatKES(total)} invoice; ${formatKES(total)} is recorded and the rest needs checking`,
      });
    }
    const postedAt = utc(r.date!);
    invoices.push({
      number,
      customer,
      oldCustomerName: r.customer_name!.trim(),
      postedAt,
      issueDay: todayInNairobi(postedAt),
      lines,
      subtotal: total.minus(tax).toFixed(2),
      taxTotal: tax.toFixed(2),
      discountTotal: discount.toFixed(2),
      total: total.toFixed(2),
      amountPaid: paid.toFixed(2),
      createdBy: (r.created_by_name ?? "").trim(),
      correction,
    });
  }
  for (const n of unmatched) {
    problems.push({
      level: "error",
      topic: "Customers",
      message: `"${n}" isn't in the customer merge list (decisions.ts); add it to a group or to the test records`,
    });
  }

  // ── Payments: compare the payments file with the invoice list ──
  const imported = new Map(invoices.map((i) => [i.number, i]));
  const paidByInvoice = new Map<string, ReturnType<typeof toDecimal>>();
  for (const p of paymentRows) {
    const n = p.invoice_number!.trim();
    paidByInvoice.set(n, (paidByInvoice.get(n) ?? toDecimal(0)).plus(money(p.amount) ?? 0));
  }
  for (const [n, sum] of paidByInvoice) {
    const inv = imported.get(n);
    if (!inv) {
      problems.push({
        level: "warning",
        topic: "Payments",
        message: `${formatKES(sum)} was paid against ${n}, which isn't in the invoice export (deleted, test or missing); not imported`,
      });
    } else if (!sum.equals(inv.amountPaid)) {
      problems.push({
        level: "warning",
        topic: "Payments",
        message: `${n} (${inv.customer}): payments file adds up to ${formatKES(sum)}, the invoice list says ${formatKES(inv.amountPaid)} paid; the invoice list is used`,
      });
    }
  }

  // ── Customers with their totals ────────────────────────────────
  // Only groups that actually appear in the files.
  const customers: PlannedCustomer[] = CUSTOMER_GROUPS.flatMap((g) => {
    const mine = invoices.filter((i) => i.customer === g.name);
    const variants = new Set<string>();
    for (const r of customerRows) if (groupOf.get(nameKey(r.name!)) === g) variants.add(r.name!.trim());
    for (const i of mine) variants.add(i.oldCustomerName);
    if (!variants.size) return [];
    return {
      name: g.name,
      type: g.type,
      phone: phones.get(g.name) ?? null,
      legacyNames: [...variants].filter((v) => v !== g.name).sort(),
      wholesale: g.type === "WHOLESALER",
      invoices: mine.length,
      outstanding: mine.reduce((s, i) => s.plus(i.total).minus(i.amountPaid), toDecimal(0)).toFixed(2),
      note: g.note,
    };
  });

  const sum = (f: (i: PlannedInvoice) => string) =>
    invoices.reduce((s, i) => s.plus(f(i)), toDecimal(0)).toFixed(2);
  const invoiced = sum((i) => i.total);
  const paid = sum((i) => i.amountPaid);

  const defaults: string[] = [];
  if (CUSTOMER_GROUPS.some((g) => g.status === "DEFAULT")) defaults.push("Customer merges (question 6)");
  if (DEMO_CUSTOMERS.status === "DEFAULT") defaults.push("Test records left out (question 7)");
  if (Object.values(VAT_ON_TOP_CORRECTIONS).some((c) => c.status === "DEFAULT"))
    defaults.push("Two VAT-on-top invoices corrected to their line totals (question 2)");
  if (AMOUNT_PAID_SOURCE.status === "DEFAULT")
    defaults.push("Amounts paid taken from the invoice list, not the payments file (questions 3–4)");
  if (PACK_SIZE_SOURCE.status === "DEFAULT")
    defaults.push("Pack sizes as in the old product list (question 8)");

  return {
    products,
    customers,
    invoices,
    openingStock,
    problems,
    totals: { invoiced, paid, outstanding: toDecimal(invoiced).minus(paid).toFixed(2) },
    oldTotals: {
      invoiced: oldInvoiced.toFixed(2),
      paid: oldPaid.toFixed(2),
      outstanding: oldBalance.toFixed(2),
    },
    defaults,
  };
}
