import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

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

test("the install sheet has screenshots, shortcuts and opens in one window", async ({ request }) => {
  const json = await (await request.get("/manifest.webmanifest")).json();
  expect(json.launch_handler).toEqual({ client_mode: ["focus-existing", "auto"] });
  expect(json.screenshots.map((s: { form_factor: string }) => s.form_factor).sort()).toEqual([
    "narrow",
    "wide",
  ]);
  const shortcuts = json.shortcuts as { url: string; icons: { src: string }[] }[];
  expect(shortcuts.map((s) => s.url)).toEqual(
    expect.arrayContaining(["/invoices/new", "/payments/new", "/stock-purchases/new"]),
  );
  const images = [...json.screenshots, ...shortcuts.flatMap((s) => s.icons)] as { src: string }[];
  for (const { src } of images) {
    const res = await request.get(src);
    expect(res.status(), src).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  }
});

test("Android app link file loads signed-out and is empty until set up", async ({ request }) => {
  const res = await request.get("/.well-known/assetlinks.json", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(await res.json()).toEqual([]);
});

test("Settings → Install the app shows the steps for each device", async ({ page, isMobile }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/install");
  await expect(page.getByRole("heading", { name: "Install the app", level: 1 })).toBeVisible();
  for (const device of ["Android phone or tablet", "iPhone or iPad", "Windows PC"]) {
    await expect(page.getByRole("heading", { name: device })).toBeVisible();
  }
  await expect(page.getByText("not set up yet")).toBeVisible();
  if (!isMobile)
    await expect(page.getByRole("link", { name: "Install app" })).toHaveAttribute(
      "href",
      "/settings/install",
    );
});
