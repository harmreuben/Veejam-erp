import "server-only";

import { writeAudit } from "@/server/audit/audit";
import { hasPermission } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { isUniqueViolation } from "@/server/modules/inventory/stock";
import { hitLimit, LIMITS } from "@/server/security/rate-limit";

import { errorText, runCommand } from "./commands";
import { commandName, parseCommand } from "./parse";
import type { WhatsAppProvider } from "./provider";
import type { InboundMessage } from "./webhook";

/**
 * Handle one incoming WhatsApp message:
 *   1. store it — a message id seen before is a duplicate delivery and is dropped;
 *   2. rate-limit the sender;
 *   3. identify the sender: an active owner whose linked number this is, and
 *      (for real messages) the number in VEEJAM_OWNER_WHATSAPP_NUMBER;
 *   4. parse and run the command, and send the reply through the provider.
 * Strangers get one polite refusal a day and nothing else.
 */

export type InboundOptions = {
  provider: WhatsAppProvider;
  /** VEEJAM_OWNER_WHATSAPP_NUMBER. Real (non-simulated) messages must come from it. */
  ownerNumber: string | undefined;
  /** Sent from the in-app simulator by a signed-in owner (mock provider only). */
  simulated: boolean;
  now?: Date;
};

export type InboundResult = {
  outcome: "duplicate" | "limited" | "refused" | "processed" | "failed";
  reply: string | null;
};

export const REFUSAL =
  "Hello. This number belongs to VeeJam Limited's office system and only accepts messages from the owner. " +
  "For orders or questions, please call or message our sales team.";

export async function handleInbound(
  db: Db,
  msg: InboundMessage,
  opts: InboundOptions,
): Promise<InboundResult> {
  let row: { id: string };
  try {
    row = await db.whatsAppMessage.create({
      data: {
        direction: "IN",
        waNumber: msg.from,
        body: msg.text ?? `[${msg.type} message]`,
        providerMessageId: msg.id,
        status: "RECEIVED",
        simulated: opts.simulated,
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "duplicate", reply: null };
    throw error;
  }

  const limit = await hitLimit(db, `wa:from:${msg.from}`, LIMITS.whatsappSender, opts.now);
  if (!limit.allowed) {
    await db.whatsAppMessage.update({
      where: { id: row.id },
      data: { status: "REFUSED", error: "Rate limited" },
    });
    // Say so once per window; after that stay quiet so a loop can't run up messages.
    const reply =
      limit.count === LIMITS.whatsappSender.limit + 1
        ? "Too many messages. Wait a minute and try again."
        : null;
    if (reply) await opts.provider.send(db, { to: msg.from, body: reply });
    return { outcome: "limited", reply };
  }

  const user = await db.user.findUnique({ where: { whatsappNumber: msg.from } });
  const numberAllowed = opts.ownerNumber
    ? opts.ownerNumber === msg.from
    : opts.simulated && opts.provider.name === "mock";
  const allowed = !!user && user.isActive && hasPermission(user.role, "whatsapp.use") && numberAllowed;

  if (!allowed) {
    await db.whatsAppMessage.update({
      where: { id: row.id },
      data: { status: "REFUSED", error: user ? "Not allowed to run commands" : "Unknown sender" },
    });
    const once = await hitLimit(db, `wa:refused:${msg.from}`, { limit: 1, windowSeconds: 86_400 }, opts.now);
    if (!once.allowed) return { outcome: "refused", reply: null };
    await writeAudit(db, {
      actorUserId: user?.id ?? null,
      actorLabel: `whatsapp:${msg.from}`,
      action: "WHATSAPP_SENDER_REFUSED",
      entityType: "WhatsAppMessage",
      entityId: row.id,
      summary: user
        ? `${user.email} tried a WhatsApp command without permission`
        : "Message from an unknown number",
      metadata: { from: msg.from, simulated: opts.simulated },
    });
    await opts.provider.send(db, { to: msg.from, body: REFUSAL });
    return { outcome: "refused", reply: REFUSAL };
  }

  const actor = { id: user.id, email: user.email, role: user.role };
  const command = msg.text === null ? null : parseCommand(msg.text);
  let reply: string;
  let failed = false;
  try {
    reply =
      command === null
        ? "I can only read text messages. Send HELP for the list of commands."
        : await runCommand(
            {
              db,
              actor,
              waNumber: msg.from,
              now: opts.now,
              audit: { ipAddress: null, userAgent: opts.simulated ? "WhatsApp (simulated)" : "WhatsApp" },
            },
            command,
          );
  } catch (error) {
    failed = true;
    console.error(error);
    reply = errorText(error);
  }
  await db.whatsAppMessage.update({
    where: { id: row.id },
    data: {
      status: failed ? "FAILED" : "PROCESSED",
      userId: user.id,
      command: command ? commandName(command) : null,
      error: failed ? reply.slice(0, 1000) : null,
    },
  });
  await db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
  await opts.provider.send(db, { to: msg.from, body: reply, userId: user.id });
  return { outcome: failed ? "failed" : "processed", reply };
}
