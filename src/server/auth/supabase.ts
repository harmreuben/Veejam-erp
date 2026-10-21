import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getServerEnv } from "@/config/env";
import { SESSION_COOKIE_OPTIONS } from "@/server/auth/cookie-options";
import { ConflictError, ValidationError } from "@/server/errors";

export function isSupabaseConfigured(): boolean {
  const env = getServerEnv();
  return !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/**
 * Supabase client bound to the current request's cookies.
 * Use in server components, server actions and route handlers.
 */
export async function createSupabaseServerClient() {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Admin client using the service-role key. SERVER ONLY. Bypasses all Supabase
 * security rules, so it is used only for user administration (lookups, bans).
 * Returns null when the key isn't configured.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function requireAdmin() {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new ConflictError(
      "Adding users needs SUPABASE_SERVICE_ROLE_KEY in the server settings. Ask whoever set up the system.",
    );
  }
  return admin;
}

/** Hooks for createStaffAccount: create/delete a Supabase sign-in without sending email. */
export const supabaseAccountHooks = {
  async createAccount(email: string, password: string): Promise<string> {
    const { data, error } = await requireAdmin().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      if (error?.message.toLowerCase().includes("already")) {
        throw new ValidationError({
          email: [
            "A sign-in account with this email already exists. Grant it access with npm run user:grant.",
          ],
        });
      }
      throw new ConflictError(`Supabase couldn't create the account: ${error?.message ?? "unknown error"}`);
    }
    return data.user.id;
  },
  async deleteAccount(authUserId: string): Promise<void> {
    await requireAdmin().auth.admin.deleteUser(authUserId);
  },
};

/** Block or unblock sign-in for a Supabase account (used when deactivating users). */
export async function setSupabaseBan(authUserId: string, banned: boolean): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin.auth.admin.updateUserById(authUserId, {
    ban_duration: banned ? "876000h" : "none",
  });
  if (error) throw new Error(error.message);
}
