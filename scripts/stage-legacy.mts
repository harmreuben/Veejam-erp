/**
 * Copy the old system's CSV exports into the staging tables, unchanged.
 *
 *   npm run legacy:stage                 (reads every .csv in legacy-data/)
 *   npm run legacy:stage -- path\to\folder
 *
 * Staging doesn't create customers, invoices or payments. That happens in
 * Phase 3, after the owner has answered the questions in docs/DATA_MIGRATION.md.
 */
import "./load-env.mjs";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createPrismaClient } from "@/server/db/client";
import { ValidationError } from "@/server/errors";
import { stageLegacyFile } from "@/server/modules/legacy/staging";

const folder = path.resolve(process.argv[2] ?? "legacy-data");
const files = (await readdir(folder).catch(() => [])).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
if (!files.length) {
  console.error(`\nNo .csv files found in ${folder}\n`);
  process.exit(1);
}

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
let failed = 0;
try {
  for (const file of files) {
    try {
      const result = await stageLegacyFile(db, file, await readFile(path.join(folder, file)), {
        id: null,
        label: "cli:legacy-stage",
      });
      console.log(
        `${result.status === "staged" ? "✔" : "·"} ${file}: ${result.rows} rows (${result.status})`,
      );
    } catch (error) {
      failed++;
      const msg =
        error instanceof ValidationError
          ? Object.values(error.fieldErrors).flat().join("; ")
          : (error as Error).message;
      console.error(`✘ ${file}: ${msg}`);
    }
  }
} finally {
  await db.$disconnect();
}
if (failed) process.exitCode = 1;
