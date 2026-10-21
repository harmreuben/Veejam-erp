import { formatKES } from "@/lib/money";

import type { LegacyPlan } from "./plan";

const kes = (v: string) => formatKES(v);
const typeLabel: Record<string, string> = {
  WHOLESALER: "Wholesaler",
  WALK_IN: "Walk-in",
  SUPERMARKET: "Supermarket",
};

/** The import report as Markdown, for the owner to check before importing. */
export function renderReport(plan: LegacyPlan): string {
  const out: string[] = [];
  const errors = plan.problems.filter((p) => p.level === "error");
  out.push("# Old system import report", "");
  out.push(
    errors.length
      ? `**${errors.length} error(s) must be fixed before importing.**`
      : "No errors. This is what `npm run legacy:import -- --commit` will create.",
    "",
  );
  if (plan.defaults.length) {
    out.push("## Decisions still using defaults (owner to confirm)", "");
    for (const d of plan.defaults) out.push(`- ${d}`);
    out.push("");
  }
  out.push("## Totals", "");
  out.push("| | Old system | Imported |", "| --- | ---: | ---: |");
  out.push(`| Invoiced | ${kes(plan.oldTotals.invoiced)} | ${kes(plan.totals.invoiced)} |`);
  out.push(`| Paid | ${kes(plan.oldTotals.paid)} | ${kes(plan.totals.paid)} |`);
  out.push(`| Outstanding | ${kes(plan.oldTotals.outstanding)} | ${kes(plan.totals.outstanding)} |`, "");
  out.push(
    "The difference is the two invoices where the old system added VAT on top of VAT-inclusive prices.",
    "",
  );

  out.push(`## Customers (${plan.customers.length})`, "");
  out.push("| Customer | Type | Phone | Old names merged in | Invoices | Owes | Note |");
  out.push("| --- | --- | --- | --- | ---: | ---: | --- |");
  for (const c of plan.customers) {
    out.push(
      `| ${c.name} | ${typeLabel[c.type] ?? c.type} | ${c.phone ? `0${c.phone.slice(3)}` : "—"} | ${c.legacyNames.join(", ") || "—"} | ${c.invoices} | ${kes(c.outstanding)} | ${c.note ?? ""} |`,
    );
  }
  out.push("", "Phones that were placeholders in the old system (0700, 07…) are left blank.", "");

  out.push(`## Products (${plan.products.length})`, "");
  out.push(
    "| SKU | Name | Pieces/packet | Packets/carton | Retail per packet | Wholesale per packet | Wholesale per carton |",
  );
  out.push("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const p of plan.products) {
    out.push(
      `| ${p.sku} | ${p.name} | ${p.unitsPerPack} | ${p.packsPerCarton} | ${kes(p.retailPack)} | ${kes(p.wholesalePack)} | ${kes(p.wholesaleCarton)} |`,
    );
  }
  out.push(
    "",
    "Retail prices go on the Standard price list; wholesale prices on a new Wholesale list, which wholesalers are given. Cost prices are left blank (the old system had 0). Stock is **not** brought across: count it on cut-over day.",
    "",
  );

  if (plan.openingStock.length) {
    out.push(`## Opening stock (${plan.openingStock.length} products)`, "");
    out.push(
      "From the old system's inventory report, posted once as an opening-balance stock adjustment in the main warehouse. Products that already have stock movements in the new system are left alone.",
      "",
    );
    out.push("| SKU | Cartons | Loose packets | Packets | Pieces |", "| --- | ---: | ---: | ---: | ---: |");
    for (const st of plan.openingStock) {
      out.push(
        `| ${st.sku} | ${st.cartons} | ${st.loose} | ${st.packs} | ${st.pieces.toLocaleString("en-KE")} |`,
      );
    }
    out.push("");
  }

  out.push(`## Historical invoices (${plan.invoices.length})`, "");
  out.push(
    "Kept with their original VJL- numbers and dates, read-only, VAT-inclusive. They take no stock out (that already happened in the old system).",
    "",
  );
  out.push("| Number | Date | Customer | Total | Discount | Paid | Balance |");
  out.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
  for (const i of [...plan.invoices].sort((a, b) => +a.postedAt - +b.postedAt)) {
    const bal = (Number(i.total) - Number(i.amountPaid)).toFixed(2);
    out.push(
      `| ${i.number}${i.correction ? " ⚠" : ""} | ${i.issueDay} | ${i.customer} | ${kes(i.total)} | ${Number(i.discountTotal) ? kes(i.discountTotal) : ""} | ${kes(i.amountPaid)} | ${Number(bal) ? kes(bal) : ""} |`,
    );
  }
  out.push("", "⚠ = total corrected (see below).", "");

  out.push("## Problems and notes", "");
  for (const level of ["error", "warning", "info"] as const) {
    const list = plan.problems.filter((p) => p.level === level);
    if (!list.length) continue;
    out.push(`### ${level === "error" ? "Errors" : level === "warning" ? "Warnings" : "Notes"}`, "");
    for (const p of list) out.push(`- **${p.topic}:** ${p.message}`);
    out.push("");
  }
  for (const i of plan.invoices.filter((x) => x.correction)) out.push(`- **${i.number}:** ${i.correction}`);
  out.push(
    "",
    "Not imported: the old stock movement history, commissions (question 9), the eTIMS queue (question 10), the old audit log. All nine files stay in the staging tables (`npm run legacy:stage`) for reference.",
    "",
  );
  return out.join("\n");
}
