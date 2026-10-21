/**
 * Rebuild the browser-test database before the app starts:
 * apply every migration, seed, and link the test accounts to roles.
 */
import { createPrismaClient } from "@/server/db/client";
import { applySeed } from "@/server/seed";

import { rebuildTestDatabase } from "../../integration/db";
import { E2E_DATABASE_URL, E2E_USERS } from "./fixtures.mjs";

await rebuildTestDatabase(E2E_DATABASE_URL);
const db = createPrismaClient(E2E_DATABASE_URL);
try {
  await applySeed(db);
  for (const u of Object.values(E2E_USERS)) {
    if (!u.role) continue;
    await db.user.create({
      data: { authUserId: u.authUserId, email: u.email, fullName: u.fullName, role: u.role },
    });
  }
  console.log("[e2e] database ready");
} finally {
  await db.$disconnect();
}
