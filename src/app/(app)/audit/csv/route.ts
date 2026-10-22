import { csvResponse } from "@/lib/csv";
import { hasPermission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { exportAudit } from "@/server/audit/queries";
import { getDb } from "@/server/db/client";
import { clientIp } from "@/server/security/client-ip";

/** GET /audit/csv → the filtered audit log as CSV (audited). */
export async function GET(req: Request) {
  const session = await getSession();
  if (session.kind !== "user") return new Response("Sign in first", { status: 401 });
  const u = session.user;
  if (!hasPermission(u.role, "audit.view")) return new Response("Not allowed", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await exportAudit(
    getDb(),
    { id: u.id, email: u.email, role: u.role },
    {
      q: sp.get("q") ?? undefined,
      action: sp.get("action") || undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    },
    { ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") },
  );
  return csvResponse(
    [
      ["When (UTC)", "Who", "Action", "Record", "Record id", "Summary", "Before", "After", "IP address"],
      ...rows.map((r) => [
        r.occurredAt.toISOString(),
        r.actorLabel,
        r.action,
        r.entityType,
        r.entityId,
        r.summary,
        r.before === null ? "" : JSON.stringify(r.before),
        r.after === null ? "" : JSON.stringify(r.after),
        r.ipAddress,
      ]),
    ],
    `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
  );
}
