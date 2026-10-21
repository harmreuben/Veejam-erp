/**
 * Show what is in the database, through both connection strings in .env.local.
 * Passwords are never printed.
 *
 *   npm run db:check
 */
import "./load-env.mjs";

import { createPrismaClient } from "@/server/db/client";

function describe(url: string | undefined): string {
  if (!url) return "(not set)";
  try {
    const u = new URL(url);
    return `${u.username}@${u.hostname}:${u.port}${u.pathname}`;
  } catch {
    return "(not a valid URL)";
  }
}

for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
  const url = process.env[name];
  console.log(
    `\n${name}: ${describe(url)}   ${name === "DATABASE_URL" ? "← the app uses this" : "← migrations, seed and imports use this"}`,
  );
  if (!url) continue;
  const db = createPrismaClient(url);
  try {
    const [products, lists, items, customers, invoices, historical, settings] = await Promise.all([
      db.product.count(),
      db.priceList.findMany({ include: { _count: { select: { items: true, customers: true } } } }),
      db.priceListItem.count(),
      db.customer.count(),
      db.salesDocument.count({ where: { kind: "INVOICE" } }),
      db.salesDocument.count({ where: { historical: true } }),
      db.companySettings.findUnique({ where: { id: 1 }, select: { defaultPriceListId: true } }),
    ]);
    console.log(
      `  Products: ${products}   Customers: ${customers}   Invoices: ${invoices} (${historical} from the old system)`,
    );
    console.log(`  Prices: ${items}`);
    for (const l of lists) {
      console.log(
        `  Price list ${l.code} "${l.name}": ${l._count.items} prices, ${l._count.customers} customers, ${l.status}` +
          (l.id === settings?.defaultPriceListId ? "  (default)" : ""),
      );
    }
    if (!lists.length) console.log("  No price lists.");
  } catch (error) {
    console.log(
      `  Could not read: ${
        String((error as Error).message ?? error)
          .trim()
          .split("\n")
          .slice(-1)[0]
      }`,
    );
  } finally {
    await db.$disconnect();
  }
}
console.log("");
