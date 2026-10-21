import { randomUUID } from "node:crypto";

import type { UserRole } from "@/generated/prisma/enums";
import type { Actor } from "@/server/auth/permissions";
import { createPrismaClient, type Db } from "@/server/db/client";

import { TEST_DATABASE_URL } from "./db";

export function testDb(): Db {
  return createPrismaClient(TEST_DATABASE_URL);
}

let counter = 0;

/** Insert a user directly (no Supabase) and return it as an Actor. */
export async function makeUser(
  db: Db,
  role: UserRole,
  overrides: { isActive?: boolean; email?: string } = {},
): Promise<Actor & { authUserId: string; fullName: string }> {
  counter++;
  const isActive = overrides.isActive ?? true;
  const user = await db.user.create({
    data: {
      authUserId: randomUUID(),
      email: overrides.email ?? `${role.toLowerCase()}${counter}@veejam.test`,
      fullName: `${role} Person ${counter}`,
      role,
      isActive,
      deactivatedAt: isActive ? null : new Date(),
    },
  });
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    authUserId: user.authUserId,
    fullName: user.fullName,
  };
}
