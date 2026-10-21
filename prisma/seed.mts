/**
 * Database seed: `npm run db:seed` (also run automatically by `prisma migrate reset`).
 * Creates company settings and document numbering if they are missing.
 */
import "../scripts/load-env.mjs";

import { createPrismaClient } from "@/server/db/client";
import { applySeed } from "@/server/seed";

const db = createPrismaClient(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "");

try {
  const report = await applySeed(db);
  console.log(
    `Company settings: ${report.companySettings}. ` +
      `Document sequences created: ${report.sequencesCreated.length ? report.sequencesCreated.join(", ") : "none (all present)"}. ` +
      `Warehouse: ${report.warehouse}. Default price list: ${report.defaultPriceList}.`,
  );
} catch (error) {
  console.error("Seed failed:", (error as Error).message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
