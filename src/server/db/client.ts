import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";

import { planPgConnection } from "./connection";

let warnedUnverified = false;

/**
 * Creates a Prisma client for a connection string.
 * Scripts and tests call this directly; the app uses the shared client from getDb().
 * Remote databases are always reached over TLS (see connection.ts).
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to .env.local (see docs/DEPLOYMENT.md).",
    );
  }
  const { config, tls } = planPgConnection(connectionString, { caPath: process.env.DATABASE_SSL_CA_PATH });
  if (tls === "encrypted-unverified" && !warnedUnverified) {
    warnedUnverified = true;
    console.warn(
      "[db] Connection is encrypted but the server certificate is NOT verified. " +
        "Download Supabase's CA certificate to certs/supabase-ca.crt (see docs/DEPLOYMENT.md).",
    );
  }
  const adapter = new PrismaPg(config);
  return new PrismaClient({
    adapter,
    // Prisma's defaults (2 s to start a transaction, 5 s to finish) are too tight
    // for a first encrypted connection from Kenya to the database in Ireland.
    // A transaction that would truly hang is still stopped, just later.
    transactionOptions: { maxWait: 20_000, timeout: 30_000 },
  });
}

// One client per server process. In development Next.js reloads modules on
// every edit, so the client is kept on globalThis to avoid opening a new pool each time.
const globalForPrisma = globalThis as unknown as { veejamPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  globalForPrisma.veejamPrisma ??= createPrismaClient(process.env.DATABASE_URL ?? "");
  return globalForPrisma.veejamPrisma;
}

export type Db = PrismaClient;
/** A client or an open transaction — repositories and helpers accept either. */
export type DbOrTx = Prisma.TransactionClient;
