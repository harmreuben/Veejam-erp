import { androidAssetLinks } from "@/server/android";

// Read the Vercel settings on each request, so changing them needs no rebuild.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(androidAssetLinks(process.env), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
