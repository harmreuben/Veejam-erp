import "server-only";

import type { DbOrTx } from "@/server/db/client";

/**
 * Fixed-window rate limits kept in Postgres. Vercel runs many short-lived
 * instances that don't share memory, so an in-memory counter would let an
 * attacker spread attempts across instances.
 */

export type Limit = { limit: number; windowSeconds: number };

export const LIMITS = {
  /** Failed sign-ins per email address. */
  signInEmail: { limit: 8, windowSeconds: 15 * 60 },
  /** Failed sign-ins per IP address (offices share an IP, so this is higher). */
  signInIp: { limit: 30, windowSeconds: 15 * 60 },
  /** Webhook calls per IP. Meta sends bursts, so this is generous. */
  webhookIp: { limit: 300, windowSeconds: 60 },
  /** Messages per WhatsApp sender. */
  whatsappSender: { limit: 20, windowSeconds: 60 },
  /** Password reset emails per address (each email costs and can annoy). */
  resetEmail: { limit: 3, windowSeconds: 60 * 60 },
  /** Password reset requests per IP. */
  resetIp: { limit: 10, windowSeconds: 60 * 60 },
  /** Share-link opens per IP. */
  shareLinkIp: { limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, Limit>;

export type LimitResult = { allowed: boolean; count: number; retryAfterSeconds: number };

function windowOf(windowSeconds: number, now: Date) {
  const ms = windowSeconds * 1000;
  const start = new Date(Math.floor(now.getTime() / ms) * ms);
  const retryAfterSeconds = Math.max(1, Math.ceil((start.getTime() + ms - now.getTime()) / 1000));
  return { start, retryAfterSeconds };
}

/** Count one attempt against `key` and say whether it is within the limit. */
export async function hitLimit(db: DbOrTx, key: string, rule: Limit, now = new Date()): Promise<LimitResult> {
  const { start, retryAfterSeconds } = windowOf(rule.windowSeconds, now);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${start}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  // Old windows are useless; tidy up now and then rather than with a scheduled job.
  if (Math.random() < 0.02) {
    await db.$executeRaw`DELETE FROM rate_limits WHERE window_start < ${new Date(now.getTime() - 86_400_000)}`;
  }
  const count = Number(rows[0]?.count ?? 1);
  return { allowed: count <= rule.limit, count, retryAfterSeconds };
}

/** Whether `key` has already used up its limit, without counting a new attempt. */
export async function isLimited(
  db: DbOrTx,
  key: string,
  rule: Limit,
  now = new Date(),
): Promise<LimitResult> {
  const { start, retryAfterSeconds } = windowOf(rule.windowSeconds, now);
  const row = await db.rateLimit.findUnique({ where: { key_windowStart: { key, windowStart: start } } });
  const count = row?.count ?? 0;
  return { allowed: count < rule.limit, count, retryAfterSeconds };
}

export function minutes(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  return m <= 1 ? "a minute" : `${m} minutes`;
}
