import type { NextConfig } from "next";

/** Baseline security headers. A full Content-Security-Policy is added in Phase 8. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Off on purpose: every ERP page is per-user and shows live financial data,
  // so pages render on each request. See docs/ARCHITECTURE.md ("Rendering").
  cacheComponents: false,
  // Browser tests build into a separate folder so their test settings never mix with a real build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
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
