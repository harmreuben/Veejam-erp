import { hasPermission } from "@/server/auth/permissions";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { loadPrintableDocument, renderPdf } from "@/server/modules/sales/pdf";
import { pdfResponse } from "@/server/modules/sales/pdf-response";

/** GET /documents/:id/pdf → the quotation, sales order or invoice as a PDF (signed-in staff only). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (session.kind !== "user") return new Response("Sign in first", { status: 401 });
  if (!hasPermission(session.user, "sales.view")) return new Response("Not allowed", { status: 403 });
  try {
    const doc = await loadPrintableDocument(getDb(), (await params).id);
    const download = new URL(req.url).searchParams.has("download");
    return pdfResponse(
      await renderPdf(doc),
      `${doc.title.toLowerCase().replace(/ /g, "-")}-${doc.number}.pdf`,
      download,
    );
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
