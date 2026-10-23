import { describe, expect, it } from "vitest";

import { isFreshPageLoad, opensDirectly } from "@/server/auth/landing";

const req = (headers: Record<string, string>, method = "GET") => ({ method, headers: new Headers(headers) });

describe("opening the app always starts on the start page", () => {
  it("only fresh page loads by the browser count, not the app moving between pages", () => {
    const html = "text/html,application/xhtml+xml,*/*;q=0.8";
    const nav = { accept: html, "sec-fetch-mode": "navigate" };
    expect(isFreshPageLoad(req({ ...nav, "sec-fetch-dest": "document" }))).toBe(true);
    // Passed on by the app's offline helper (service worker).
    expect(isFreshPageLoad(req({ ...nav, "sec-fetch-dest": "empty" }))).toBe(true);
    // Browsers that send no Sec-Fetch headers.
    expect(isFreshPageLoad(req({ accept: html }))).toBe(true);
    // The app's own background requests.
    expect(isFreshPageLoad(req({ accept: html, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }))).toBe(
      false,
    );
    // Moving between pages inside the app, prefetching, and server actions.
    expect(isFreshPageLoad(req({ accept: "*/*", "sec-fetch-dest": "empty", rsc: "1" }))).toBe(false);
    expect(isFreshPageLoad(req({ accept: html, rsc: "1" }))).toBe(false);
    expect(isFreshPageLoad(req({ accept: html, "next-router-prefetch": "1" }))).toBe(false);
    expect(isFreshPageLoad(req({ accept: html, "next-action": "x" }, "POST"))).toBe(false);
    // Not a page: images, frames, scripts.
    expect(isFreshPageLoad(req({ ...nav, "sec-fetch-dest": "iframe" }))).toBe(false);
    expect(isFreshPageLoad(req({ accept: "image/avif,*/*" }))).toBe(false);
  });

  it("files, sign-in pages, share links and password resets still open directly", () => {
    for (const p of [
      "/login",
      "/forgot-password",
      "/auth/confirm",
      "/reset-password",
      "/d/abc",
      "/api/health",
      "/start",
      "/documents/123/pdf",
      "/payments/123/pdf",
      "/purchase-orders/1/pdf",
      "/reports/csv/sales",
      "/audit/csv",
      "/manifest.webmanifest",
    ]) {
      expect(opensDirectly(p), p).toBe(true);
    }
    for (const p of ["/", "/dashboard", "/invoices", "/invoices/123", "/settings/users", "/pdfs"]) {
      expect(opensDirectly(p), p).toBe(false);
    }
  });
});
