import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

/**
 * Creates a Prisma client for a connection string.
 * Scripts and tests call this directly; the app uses the shared `db` below.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add your Supabase connection string to .env.local (see docs/DEPLOYMENT.md).",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// One client per server process. In development Next.js reloads modules on
// every edit, so the client is kept on globalThis to avoid opening a new pool each time.
const globalForPrisma = globalThis as unknown as { veejamPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  globalForPrisma.veejamPrisma ??= createPrismaClient(process.env.DATABASE_URL ?? "");
  return globalForPrisma.veejamPrisma;
}

export type Db = PrismaClient;
/** A client or an open transaction — repositories accept either. */
export type DbOrTx = Pick<
  PrismaClient,
  | "user"
  | "companySettings"
  | "documentSequence"
  | "auditLog"
  | "legacyImportBatch"
  | "legacyRow"
  | "$queryRaw"
>;
