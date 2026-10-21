import { expect, test } from "@playwright/test";

test("setup status page shows company profile and build plan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Setup status" })).toBeVisible();
  await expect(page.getByText("0115924570")).toBeVisible();
  await expect(page.getByText("wanjiruvenus980@gmail.com")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build plan" })).toBeVisible();
  await expect(page.getByText("WhatsApp provider")).toBeVisible();
});

test("unbuilt modules are not links", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) await page.locator("summary").click();
  const nav = page.getByRole("navigation", { name: "Modules" }).filter({ visible: true });
  await expect(nav.getByText("Invoices")).toBeVisible();
  await expect(nav.getByRole("link", { name: "Invoices" })).toHaveCount(0);
});

test("health endpoint responds and sends security headers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok" });
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});
