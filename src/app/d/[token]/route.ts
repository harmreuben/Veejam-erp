import { getDb } from "@/server/db/client";
import { resolveShareToken } from "@/server/modules/sales/extras";
import { loadPrintableDocument, renderPdf } from "@/server/modules/sales/pdf";
import { pdfResponse } from "@/server/modules/sales/pdf-response";
import { clientIp, tooManyRequests } from "@/server/security/client-ip";
import { hitLimit, LIMITS } from "@/server/security/rate-limit";

/**
 * GET /d/:token → a document shared with a customer. Public: the random token
 * is the permission. Unknown, expired and revoked links all get the same answer.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const db = getDb();
  // Tokens are 256-bit, so guessing is hopeless anyway; this keeps scanners from hammering the database.
  const limit = await hitLimit(db, `share:ip:${clientIp(req)}`, LIMITS.shareLinkIp);
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);
  const id = await resolveShareToken(db, (await params).token);
  if (!id) {
    return new Response("This link has expired or is no longer valid. Please ask VeeJam for a new one.", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  const doc = await loadPrintableDocument(db, id);
  return pdfResponse(await renderPdf(doc), `${doc.title.toLowerCase().replace(/ /g, "-")}-${doc.number}.pdf`);
}
