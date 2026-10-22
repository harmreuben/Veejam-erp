import { hasPermission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { loadPrintableReceipt, renderPdf } from "@/server/modules/sales/pdf";
import { pdfResponse } from "@/server/modules/sales/pdf-response";

/** GET /payments/:id/pdf → the receipt (signed-in staff only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.kind !== "user") return new Response("Sign in first", { status: 401 });
  if (!hasPermission(session.user, "sales.view")) return new Response("Not allowed", { status: 403 });
  try {
    const doc = await loadPrintableReceipt(getDb(), (await params).id);
    return pdfResponse(await renderPdf(doc), `receipt-${doc.number}.pdf`);
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
