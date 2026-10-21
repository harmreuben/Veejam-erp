import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma CLI does not read .env.local on its own; load it the same way Next.js does.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Prisma CLI configuration (migrate, generate, seed, studio).
 *
 * Migrations use DIRECT_URL: a direct, non-pooled Postgres connection.
 * The running app uses DATABASE_URL (pooled) through src/server/db/client.ts.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed.mts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
