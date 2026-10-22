import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { addDays } from "@/lib/dates";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";

import { writeAudit } from "./audit";

export type AuditFilter = { q?: string; action?: string; from?: string; to?: string; before?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Start of a Nairobi calendar day (UTC+3, no daylight saving) as an instant. */
const nairobiMidnight = (day: string) => new Date(`${day}T00:00:00.000+03:00`);

function where(f: AuditFilter): Prisma.AuditLogWhereInput {
  const q = f.q?.trim();
  return {
    ...(f.action ? { action: f.action } : {}),
    ...(q
      ? {
          OR: [
            { summary: { contains: q, mode: "insensitive" } },
            { actorLabel: { contains: q, mode: "insensitive" } },
            { entityType: { equals: q } },
            { entityId: { equals: q } },
          ],
        }
      : {}),
    occurredAt: {
      ...(f.from && DAY.test(f.from) ? { gte: nairobiMidnight(f.from) } : {}),
      ...(f.to && DAY.test(f.to) ? { lt: nairobiMidnight(addDays(f.to, 1)) } : {}),
    },
    ...(f.before && /^\d+$/.test(f.before) ? { id: { lt: BigInt(f.before) } } : {}),
  };
}

const PAGE = 100;

export async function listAudit(db: Db, actor: Actor, f: AuditFilter) {
  authorize(actor, "audit.view");
  const [rows, actions] = await Promise.all([
    db.auditLog.findMany({ where: where(f), orderBy: { id: "desc" }, take: PAGE + 1 }),
    db.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    rows: rows.slice(0, PAGE).map((r) => ({ ...r, id: r.id.toString() })),
    next: rows.length > PAGE ? rows[PAGE - 1]!.id.toString() : null,
    actions: actions.map((a) => a.action),
  };
}

/** Up to 20,000 matching entries for a CSV download. The export itself is audited. */
export async function exportAudit(
  db: Db,
  actor: Actor,
  f: AuditFilter,
  ctx: { ipAddress?: string | null; userAgent?: string | null } = {},
) {
  authorize(actor, "audit.view");
  const rows = await db.auditLog.findMany({
    where: where({ ...f, before: undefined }),
    orderBy: { id: "desc" },
    take: 20_000,
  });
  await writeAudit(db, {
    actorUserId: actor.id,
    actorLabel: actor.email,
    action: "AUDIT_EXPORTED",
    entityType: "AuditLog",
    summary: `Audit log exported (${rows.length} entries)`,
    metadata: {
      filter: { q: f.q ?? null, action: f.action ?? null, from: f.from ?? null, to: f.to ?? null },
    },
    ...ctx,
  });
  return rows;
}
