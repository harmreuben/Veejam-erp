import { connection } from "next/server";

/**
 * Liveness check: GET /api/health
 * Used by Vercel/uptime monitors. Returns no configuration values or secrets.
 * A database check is added in Phase 2.
 */
export async function GET() {
  await connection(); // always run at request time
  return Response.json(
    {
      status: "ok",
      service: "veejam-erp",
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
