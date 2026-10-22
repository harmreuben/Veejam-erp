import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_OPTIONS } from "@/server/auth/cookie-options";
import { isPublicPath } from "@/server/auth/resolve";

/**
 * Content-Security-Policy with a fresh nonce per request. Next.js reads the
 * nonce from the request header and puts it on its own scripts, so only
 * scripts this app sent can run; injected <script> tags are refused.
 * Styles allow inline because charts and components set style attributes.
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Runs before every page request:
 * 0. Sets the Content-Security-Policy (see above).
 * 1. Refreshes the Supabase session cookie when it is about to expire.
 * 2. Sends signed-out visitors to /login.
 *
 * This is a first line of defence only. Every page, server action and route
 * handler checks the session and permissions again on the server, because the
 * proxy can't see the database (deactivated users, roles).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", policy);
    return NextResponse.next({ request: { headers } });
  };

  let response = forward();

  let signedIn = false;
  let authMs: number | null = null;
  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookieOptions: SESSION_COOKIE_OPTIONS,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = forward();
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    });
    const started = performance.now();
    const { data } = await supabase.auth.getClaims();
    authMs = performance.now() - started;
    signedIn = !!data?.claims?.sub;
  }

  if (!signedIn && !isPublicPath(pathname)) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(login);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", policy);
  // Timings for the browser's developer tools (Network → Timing): no secrets.
  if (authMs !== null) {
    response.headers.set(
      "Server-Timing",
      `signin;dur=${authMs.toFixed(0)};desc="Sign-in check (${process.env.VERCEL_REGION ?? "local"})"`,
    );
  }
  return response;
}

export const config = {
  // Everything except static files and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
