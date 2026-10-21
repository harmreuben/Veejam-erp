/**
 * Give an existing Supabase sign-in account access to the ERP.
 *
 *   npm run user:grant -- --email owner@example.com --name "Venus Wanjiru" --role OWNER
 *
 * Use this once to create the first owner. After that, owners and admins add
 * staff from Settings → Users & roles.
 *
 * Create the sign-in account first in Supabase:
 *   Dashboard → Authentication → Users → Add user → Create new user
 *   (tick "Auto Confirm User").
 */
import "./load-env.mjs";

import { parseArgs } from "node:util";

import { UserRole } from "@/generated/prisma/enums";
import { createSupabaseAdminClient } from "@/server/auth/supabase";
import { createPrismaClient } from "@/server/db/client";
import { AppError, ValidationError } from "@/server/errors";
import { grantUserAccess } from "@/server/modules/users/service";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "OWNER" },
  },
});

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase();
const role = values.role?.toUpperCase() as UserRole;
if (!email || !values.name) {
  fail('Usage: npm run user:grant -- --email you@example.com --name "Full Name" --role OWNER');
}
if (!Object.values(UserRole).includes(role)) {
  fail(`Role must be one of: ${Object.values(UserRole).join(", ")}`);
}

const admin = createSupabaseAdminClient();
if (!admin) fail("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.");

async function findAuthUserId(target: string): Promise<string | null> {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin!.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Supabase: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
try {
  const authUserId = await findAuthUserId(email);
  if (!authUserId) {
    fail(
      `No Supabase sign-in account found for ${email}.\n` +
        "Create it in Supabase: Authentication → Users → Add user → Create new user (tick Auto Confirm User).",
    );
  }
  const user = await grantUserAccess(
    db,
    { authUserId, email, fullName: values.name, role },
    { id: null, label: "cli:user-grant" },
  );
  console.log(`\n✔ ${user.fullName} <${user.email}> can now sign in as ${user.role}.\n`);
} catch (error) {
  if (error instanceof ValidationError) fail(Object.values(error.fieldErrors).flat().join("\n"));
  if (error instanceof AppError) fail(error.message);
  throw error;
} finally {
  await db.$disconnect();
}
