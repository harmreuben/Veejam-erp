import type { NextConfig } from "next";

/**
 * Security headers on every response. The Content-Security-Policy needs a fresh
 * nonce per request, so it is set in src/proxy.ts instead of here.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers only honour this over HTTPS (Vercel), so it is harmless on localhost.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Off on purpose: every ERP page is per-user and shows live financial data,
  // so pages render on each request. See docs/ARCHITECTURE.md ("Rendering").
  cacheComponents: false,
  // Browser tests build into a separate folder so their test settings never mix with a real build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  experimental: {
    // CSV imports are capped at 2 MB in the app; allow for form-data overhead.
    serverActions: { bodySizeLimit: "3mb" },
  },
  // The database certificate is read from disk at runtime, so tell the build to
  // ship it with every server route (otherwise Vercel would leave it out).
  outputFileTracingIncludes: {
    "/**": ["./certs/*.crt"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
