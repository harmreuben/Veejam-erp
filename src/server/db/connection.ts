import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { PoolConfig } from "pg";

/** Where the Supabase database certificate authority is looked for if DATABASE_SSL_CA_PATH isn't set. */
export const DEFAULT_CA_PATH = "certs/supabase-ca.crt";

/** Query options that are for other tools (Prisma CLI, PgBouncer) and must not reach the pg driver. */
const STRIP_PARAMS = [
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "uselibpqcompat",
  "pgbouncer",
  "connect_timeout",
];

export type DbTlsMode =
  | "verified" // encrypted, and the server certificate is checked against Supabase's CA
  | "encrypted-unverified" // encrypted, certificate not checked (no CA file yet)
  | "none"; // local development/test database on this computer

export type PgConnectionPlan = { config: PoolConfig; tls: DbTlsMode };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Turn a DATABASE_URL into driver settings with encryption always on for
 * remote databases.
 *
 * - Local databases (tests) connect without TLS.
 * - Remote databases always use TLS. When the Supabase CA certificate is
 *   available (DATABASE_SSL_CA_PATH, or certs/supabase-ca.crt) the server's
 *   certificate is verified, which stops anyone on the network impersonating
 *   the database. Without it the connection is still encrypted but not verified.
 */
export function planPgConnection(
  url: string,
  options: {
    caPath?: string;
    cwd?: string;
    readFile?: (p: string) => string;
    fileExists?: (p: string) => boolean;
  } = {},
): PgConnectionPlan {
  const parsed = new URL(url);
  for (const p of STRIP_PARAMS) parsed.searchParams.delete(p);
  const connectionString = parsed.toString();
  const base: PoolConfig = { connectionString, connectionTimeoutMillis: 30_000 };

  if (LOCAL_HOSTS.has(parsed.hostname)) return { config: base, tls: "none" };

  const cwd = options.cwd ?? process.cwd();
  const exists = options.fileExists ?? existsSync;
  const read = options.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const candidate = path.resolve(cwd, options.caPath || DEFAULT_CA_PATH);

  if (exists(candidate)) {
    return { config: { ...base, ssl: { ca: read(candidate), rejectUnauthorized: true } }, tls: "verified" };
  }
  if (options.caPath) {
    throw new Error(`DATABASE_SSL_CA_PATH points to ${candidate}, but that file doesn't exist.`);
  }
  return { config: { ...base, ssl: { rejectUnauthorized: false } }, tls: "encrypted-unverified" };
}
