import "server-only";

import { z } from "zod";

import { writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { ConflictError, ValidationError } from "@/server/errors";
import { isUniqueViolation } from "@/server/modules/inventory/stock";
import type { AuditContext } from "@/server/modules/pricing/service";
import { parseInput } from "@/server/shared/validation";

/** Digits only, international format, e.g. 254712345678. 07… and +254… are converted. */
export function normaliseWhatsAppNumber(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

const linkSchema = z.object({
  whatsappNumber: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normaliseWhatsAppNumber(v);
      if (!n) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a WhatsApp number such as 0712 345 678 or 254712345678",
        });
        return z.NEVER;
      }
      return n;
    }),
});

/**
 * Link (or unlink, with a blank number) the signed-in owner's WhatsApp number.
 * When VEEJAM_OWNER_WHATSAPP_NUMBER is set, only that number can be linked.
 */
export async function linkWhatsAppNumber(
  db: Db,
  actor: Actor,
  input: unknown,
  ownerNumber: string | undefined,
  ctx: AuditContext = {},
): Promise<string | null> {
  authorize(actor, "whatsapp.use");
  const { whatsappNumber } = parseInput(linkSchema, input);
  if (whatsappNumber && ownerNumber && whatsappNumber !== ownerNumber) {
    throw new ValidationError({
      whatsappNumber: [
        "This isn't the owner number set in VEEJAM_OWNER_WHATSAPP_NUMBER. Only that number can run commands.",
      ],
    });
  }
  const before = await db.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { whatsappNumber: true },
  });
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.id }, data: { whatsappNumber } });
      await writeAudit(tx, {
        actorUserId: actor.id,
        actorLabel: actor.email,
        action: "WHATSAPP_NUMBER_LINKED",
        entityType: "User",
        entityId: actor.id,
        summary: whatsappNumber ? `WhatsApp number linked: ${whatsappNumber}` : "WhatsApp number removed",
        before: { whatsappNumber: before.whatsappNumber },
        after: { whatsappNumber },
        ...ctx,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error))
      throw new ConflictError("That WhatsApp number is already linked to another user.");
    throw error;
  }
  return whatsappNumber;
}

export async function conversation(db: Db, actor: Actor, waNumber: string, take = 60) {
  authorize(actor, "whatsapp.use");
  const rows = await db.whatsAppMessage.findMany({
    where: { waNumber },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.reverse();
}

export async function messageLog(
  db: Db,
  actor: Actor,
  filter: { q?: string; status?: string; before?: string } = {},
) {
  authorize(actor, "whatsapp.view");
  const q = filter.q?.trim();
  const status =
    filter.status &&
    ["RECEIVED", "PROCESSED", "REFUSED", "FAILED", "SENT", "SIMULATED"].includes(filter.status)
      ? (filter.status as "RECEIVED")
      : undefined;
  const rows = await db.whatsAppMessage.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { waNumber: { contains: q.replace(/\D/g, "") || q } },
              { body: { contains: q, mode: "insensitive" } },
              { command: { equals: q.toUpperCase() } },
            ],
          }
        : {}),
      ...(filter.before ? { createdAt: { lt: new Date(filter.before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { fullName: true, email: true } } },
    take: 101,
  });
  return { rows: rows.slice(0, 100), more: rows.length > 100 ? rows[99]!.createdAt.toISOString() : null };
}

export async function confirmationLog(db: Db, actor: Actor) {
  authorize(actor, "whatsapp.view");
  return db.whatsAppConfirmation.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { user: { select: { fullName: true } } },
  });
}
