import { hasPermission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { loadPrintablePurchaseOrder } from "@/server/modules/purchasing/pdf";
import { renderPdf } from "@/server/modules/sales/pdf";
import { pdfResponse } from "@/server/modules/sales/pdf-response";

/** GET /purchase-orders/:id/pdf → the order to send to the supplier (staff who can see costs). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.kind !== "user") return new Response("Sign in first", { status: 401 });
  const user = session.user;
  if (!hasPermission(user, "purchasing.view") || !hasPermission(user, "catalogue.costs")) {
    return new Response("Not allowed", { status: 403 });
  }
  try {
    const doc = await loadPrintablePurchaseOrder(getDb(), (await params).id);
    return pdfResponse(await renderPdf(doc), `purchase-order-${doc.number}.pdf`);
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
