import { expect, test } from "@playwright/test";

// The ERP can be installed as an app. These files must load without signing in,
// and the service worker must never cache ERP pages.

test("manifest, icons, service worker and offline page load signed-out", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const json = await manifest.json();
  expect(json).toMatchObject({ short_name: "VeeJam ERP", display: "standalone", start_url: "/" });
  for (const icon of json.icons as { src: string }[]) {
    const res = await request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  const code = await sw.text();
  expect(code).toContain('event.request.mode !== "navigate"');
  expect(code).not.toMatch(/cache\.put/);

  const offline = await request.get("/offline.html");
  expect(offline.status()).toBe(200);
  expect(await offline.text()).toContain("No internet connection");
});

test("pages link the manifest and allow the service worker", async ({ page }) => {
  const res = await page.goto("/login");
  expect(res!.headers()["content-security-policy"]).toContain("worker-src 'self'");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});
