import "server-only";

import type { DbOrTx } from "@/server/db/client";

/**
 * Sending WhatsApp messages. Every outgoing message is written to
 * whatsapp_messages whichever provider is used, so the log is complete.
 *
 * - mock: nothing leaves the server; the message is stored as SIMULATED and
 *   shown in the in-app simulator.
 * - meta: the Cloud API. Connected and tested in Phase 7; until then it refuses
 *   to send rather than pretending to.
 */
export type ProviderName = "mock" | "meta";

export type OutgoingMessage = { to: string; body: string; userId?: string | null };

export interface WhatsAppProvider {
  readonly name: ProviderName;
  send(
    db: DbOrTx,
    message: OutgoingMessage,
  ): Promise<{ id: string; status: "SENT" | "SIMULATED" | "FAILED" }>;
}

/** WhatsApp's limit is 4096 characters; keep a margin and say so when cut. */
export function fitMessage(body: string): string {
  return body.length <= 4000 ? body : `${body.slice(0, 3950)}\n… (cut short; open the ERP for the rest)`;
}

export const mockProvider: WhatsAppProvider = {
  name: "mock",
  async send(db, { to, body, userId }) {
    const row = await db.whatsAppMessage.create({
      data: {
        direction: "OUT",
        waNumber: to,
        body: fitMessage(body),
        status: "SIMULATED",
        userId: userId ?? null,
        simulated: true,
      },
    });
    return { id: row.id, status: "SIMULATED" };
  },
};

export const metaProvider: WhatsAppProvider = {
  name: "meta",
  async send(db, { to, body, userId }) {
    const row = await db.whatsAppMessage.create({
      data: {
        direction: "OUT",
        waNumber: to,
        body: fitMessage(body),
        status: "FAILED",
        userId: userId ?? null,
        error: "The Meta Cloud API provider is connected in Phase 7. Use WHATSAPP_PROVIDER=mock until then.",
      },
    });
    return { id: row.id, status: "FAILED" };
  },
};

export function getProvider(name: ProviderName): WhatsAppProvider {
  return name === "meta" ? metaProvider : mockProvider;
}
