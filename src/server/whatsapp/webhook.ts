import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's webhook signature: "sha256=" + hex HMAC-SHA256 of the raw request
 * body with the app secret. Compared in constant time. The body must be the
 * exact bytes received; re-serialised JSON would not match.
 */
export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signBody(rawBody, secret), "utf8");
  const given = Buffer.from(header.toLowerCase(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type InboundMessage = {
  id: string;
  from: string;
  /** Text body, or null for images, voice notes and other types. */
  text: string | null;
  type: string;
  timestamp: number | null;
};

/**
 * Pull the messages out of a Cloud API webhook payload
 * (entry[].changes[].value.messages[]). Delivery/read statuses are ignored.
 * Anything malformed is skipped rather than trusted.
 */
export function extractMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { field?: string; value?: { messages?: unknown } })?.value;
      const messages = value?.messages;
      if (!Array.isArray(messages)) continue;
      for (const m of messages) {
        const msg = m as {
          id?: unknown;
          from?: unknown;
          type?: unknown;
          timestamp?: unknown;
          text?: { body?: unknown };
        };
        if (typeof msg.id !== "string" || msg.id.length > 200) continue;
        if (typeof msg.from !== "string" || !/^[1-9]\d{7,14}$/.test(msg.from)) continue;
        const type = typeof msg.type === "string" ? msg.type : "unknown";
        const text =
          type === "text" && typeof msg.text?.body === "string" ? msg.text.body.slice(0, 4096) : null;
        const ts = Number(msg.timestamp);
        out.push({ id: msg.id, from: msg.from, text, type, timestamp: Number.isFinite(ts) ? ts : null });
      }
    }
  }
  return out;
}
