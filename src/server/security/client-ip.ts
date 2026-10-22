/**
 * The caller's IP address from a route handler request. On Vercel the
 * x-forwarded-for header is set by the platform, so its first entry is the client.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

export function tooManyRequests(
  retryAfterSeconds: number,
  body = "Too many requests. Try again shortly.",
): Response {
  return new Response(body, {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retryAfterSeconds),
      "Cache-Control": "no-store",
    },
  });
}
