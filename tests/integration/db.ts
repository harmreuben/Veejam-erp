import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { config, parse } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

/** Refuse anything that looks like a real database, so tests can never wipe production. */
export function assertSafeTestDatabase(url: string): void {
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests need a separate, disposable Postgres database (see docs/TESTING.md).",
    );
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) {
    throw new Error(`Refusing to run: the test database name must contain "test" (got "${name}").`);
  }
  // Compare with the real app settings in .env.local (not process.env, which the
  // browser-test server deliberately points at the test database).
  const real = existsSync(".env.local") ? parse(readFileSync(".env.local")) : {};
  if (url === real.DATABASE_URL || url === real.DIRECT_URL) {
    throw new Error(
      "Refusing to run: the test database is the same as DATABASE_URL/DIRECT_URL in .env.local.",
    );
  }
}

/** Drop everything and apply every migration in order, exactly as `prisma migrate deploy` would. */
export async function rebuildTestDatabase(url = TEST_DATABASE_URL): Promise<void> {
  assertSafeTestDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const dir = path.resolve("prisma/migrations");
    const migrations = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      await client.query("BEGIN");
      await client.query(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
      await client.query("COMMIT");
    }
  } finally {
    await client.end();
  }
}

/**
 * Remove all rows from every table between tests. Append-only tables block
 * TRUNCATE with triggers, so triggers are switched off for this session only.
 */
export async function clearTestData(url = TEST_DATABASE_URL): Promise<void> {
  assertSafeTestDatabase(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    const list = rows.map((r) => `"${r.tablename}"`).join(", ");
    await client.query(`SET session_replication_role = replica; TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
  } finally {
    await client.end();
  }
}

export async function rawQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}
