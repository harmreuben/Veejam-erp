/**
 * Bring the old system's data into VeeJam ERP.
 *
 *   npm run legacy:import                       check only: writes legacy-data/import-report.md, changes nothing
 *   npm run legacy:import -- --commit           import (as the first active owner)
 *   npm run legacy:import -- --commit --by you@example.com
 *
 * Reads the nine CSV exports in legacy-data/. Decisions (customer merges,
 * corrections) live in src/server/modules/legacy/decisions.ts.
 */
import "./load-env.mjs";

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "csv-parse/sync";

import { createPrismaClient } from "@/server/db/client";
import { applyLegacyPlan } from "@/server/modules/legacy/apply";
import { buildLegacyPlan, type LegacyRows } from "@/server/modules/legacy/plan";
import { renderReport } from "@/server/modules/legacy/report";
import { legacyKindFromFileName } from "@/server/modules/legacy/staging";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const byIndex = args.indexOf("--by");
const byEmail = byIndex >= 0 ? args[byIndex + 1]?.toLowerCase() : undefined;
const folder = path.resolve(
  args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--by") ?? "legacy-data",
);

const files: LegacyRows = {};
for (const f of (await readdir(folder).catch(() => [])).sort()) {
  const kind = legacyKindFromFileName(f);
  if (kind)
    files[kind] = parse(await readFile(path.join(folder, f)), {
      columns: true,
      bom: true,
      skip_empty_lines: true,
    });
}
if (!Object.keys(files).length) {
  console.error(`\nNo old-system CSV files found in ${folder}\n`);
  process.exit(1);
}

const plan = buildLegacyPlan(files);
const reportPath = path.join(folder, "import-report.md");
await writeFile(reportPath, renderReport(plan), "utf8");

const errors = plan.problems.filter((p) => p.level === "error");
const warnings = plan.problems.filter((p) => p.level === "warning");
console.log(`
Old system import ${commit ? "" : "(check only — nothing is saved)"}
  Customers: ${plan.customers.length}    Products: ${plan.products.length}    Historical invoices: ${plan.invoices.length}    Opening stock: ${plan.openingStock.length} products
  Invoiced: KES ${plan.totals.invoiced}    Paid: KES ${plan.totals.paid}    Outstanding: KES ${plan.totals.outstanding}
  Problems: ${errors.length} errors, ${warnings.length} warnings
  Full report: ${reportPath}
`);
for (const e of errors) console.error(`  ✘ ${e.topic}: ${e.message}`);

if (!commit) {
  console.log(
    errors.length
      ? "Fix the errors, then run again."
      : "Read the report. To import, run: npm run legacy:import -- --commit",
  );
  process.exit(errors.length ? 1 : 0);
}
if (errors.length) process.exit(1);

const db = createPrismaClient(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");
try {
  const actor = await db.user.findFirst({
    where: { isActive: true, ...(byEmail ? { email: byEmail } : { role: "OWNER" }) },
    orderBy: { createdAt: "asc" },
  });
  if (!actor)
    throw new Error(
      byEmail ? `No active user ${byEmail}` : "No active owner found. Run npm run user:grant first.",
    );
  console.log(`Importing as ${actor.email}… (this can take a minute)`);
  const r = await applyLegacyPlan(db, { id: actor.id, email: actor.email }, plan);
  console.log(`
✔ Done.
  Products: ${r.productsCreated} created, ${r.productsKept} already there
  Prices set: ${r.pricesSet}
  Customers: ${r.customersCreated} created, ${r.customersMatched} matched to existing ones
  Historical invoices: ${r.invoicesCreated} created, ${r.invoicesAlreadyThere} already there
  Opening stock: ${r.stockSet} products set${r.stockSkipped ? `, ${r.stockSkipped} skipped (already had stock or already imported)` : ""}
`);
} catch (error) {
  console.error("Import failed, nothing was saved:", (error as Error).message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
