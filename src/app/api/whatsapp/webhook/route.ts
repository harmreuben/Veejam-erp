import { getServerEnv } from "@/config/env";
import { getDb } from "@/server/db/client";
import { clientIp, tooManyRequests } from "@/server/security/client-ip";
import { hitLimit, LIMITS } from "@/server/security/rate-limit";
import { handleInbound } from "@/server/whatsapp/inbound";
import { getProvider } from "@/server/whatsapp/provider";
import { extractMessages, verifySignature } from "@/server/whatsapp/webhook";

/**
 * WhatsApp Cloud API webhook.
 *
 * GET  — Meta's one-time verification: echo hub.challenge only when
 *        hub.verify_token matches META_WHATSAPP_VERIFY_TOKEN.
 * POST — messages. Refused unless X-Hub-Signature-256 is a valid HMAC of the
 *        raw body with META_APP_SECRET. Each message id is processed once, so
 *        Meta's retries are harmless. Always answers 200 once the signature is
 *        valid, so a failing command can't trigger a retry storm.
 */

export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function GET(req: Request) {
  const env = getServerEnv();
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  if (
    mode === "subscribe" &&
    env.META_WHATSAPP_VERIFY_TOKEN &&
    token === env.META_WHATSAPP_VERIFY_TOKEN &&
    /^[\w-]{1,200}$/.test(challenge)
  ) {
    return text(challenge, 200);
  }
  return text("Forbidden", 403);
}

export async function POST(req: Request) {
  const env = getServerEnv();
  const db = getDb();
  const limit = await hitLimit(db, `webhook:ip:${clientIp(req)}`, LIMITS.webhookIp);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  if (!env.META_APP_SECRET) return text("WhatsApp webhook is not configured", 503);
  const raw = await req.text();
  if (raw.length > 1_000_000) return text("Too large", 413);
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
    return text("Invalid signature", 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return text("Bad JSON", 400);
  }

  const provider = getProvider(env.WHATSAPP_PROVIDER);
  for (const message of extractMessages(payload)) {
    try {
      await handleInbound(db, message, {
        provider,
        ownerNumber: env.VEEJAM_OWNER_WHATSAPP_NUMBER,
        simulated: false,
      });
    } catch (error) {
      console.error("WhatsApp message failed", error);
    }
  }
  return text("OK", 200);
}
