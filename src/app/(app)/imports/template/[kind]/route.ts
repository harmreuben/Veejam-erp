import { ImportKind } from "@/generated/prisma/enums";
import { hasPermission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { templateCsv } from "@/server/modules/imports/definitions";

/** GET /imports/template/products → an empty CSV with the right headers. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (session.kind !== "user") return new Response("Sign in first", { status: 401 });
  if (!hasPermission(session.user, "imports.run")) return new Response("Not allowed", { status: 403 });
  const kind = (await params).kind.toUpperCase();
  if (!(kind in ImportKind)) return new Response("Unknown template", { status: 404 });
  return new Response(`﻿${templateCsv(kind as ImportKind)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="veejam-${kind.toLowerCase()}-template.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
