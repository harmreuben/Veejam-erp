import { isPublicPath } from "./resolve";

/**
 * "Open on the start page": a fresh load of the app (opening it, reloading, a
 * bookmark or a link from outside) always lands on the person's start page
 * (the dashboard, or their own start page), not wherever they last were.
 * Moving around inside the app is unaffected: those requests are made by the
 * app itself, not full page loads.
 */

/** Cookie set by /start for one minute: lets exactly that start page load. */
export const LANDING_COOKIE = "vj-landing";
/** Where fresh loads are sent; it works out the person's start page. */
export const START_PATH = "/start";

/** Pages a fresh load may open directly (everything else goes to the start page). */
export function opensDirectly(pathname: string): boolean {
  return (
    isPublicPath(pathname) ||
    pathname === START_PATH ||
    // Reached from a password reset link.
    pathname === "/reset-password" ||
    // Files, not pages: PDFs and CSV downloads open in their own tab.
    /\/pdf$/.test(pathname) ||
    /\/csv(\/|$)/.test(pathname) ||
    pathname.startsWith("/api/")
  );
}

/**
 * Is this request a fresh page load by the browser (not the app moving between
 * pages, prefetching, or calling the server)? Browsers mark page loads with
 * Sec-Fetch-Mode: navigate. Sec-Fetch-Dest says "document" too, except when the
 * app's offline helper (service worker) passes the load on, where it becomes
 * "empty" but the mode stays "navigate". The app's own requests carry an RSC /
 * Next-Action header. Browsers that send neither header: a GET asking for HTML.
 */
export function isFreshPageLoad(req: { method: string; headers: Headers }): boolean {
  const h = req.headers;
  if (req.method !== "GET" || h.has("rsc") || h.has("next-router-prefetch") || h.has("next-action")) {
    return false;
  }
  const mode = h.get("sec-fetch-mode");
  const dest = h.get("sec-fetch-dest");
  if (mode !== null || dest !== null) {
    return mode === "navigate" && (dest === null || dest === "document" || dest === "empty");
  }
  return (h.get("accept") ?? "").includes("text/html");
}
