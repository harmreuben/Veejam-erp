import { expect, test } from "@playwright/test";

import { signIn, signOut } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

test("health endpoint responds and sends security headers", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok" });
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("signed-out visitors are sent to sign-in, then back to the page they wanted", async ({ page }) => {
  await page.goto("/settings/company");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings%2Fcompany$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText("VeeJam Limited").first()).toBeVisible();

  await page.getByLabel("Email").fill(E2E_USERS.owner.email);
  await page.getByLabel("Password").fill(E2E_USERS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings\/company$/);
  await expect(page.getByRole("heading", { level: 1, name: "Company settings" })).toBeVisible();
});

test("owner sees the setup status with company details from the database", async ({ page, isMobile }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password);
  await expect(page.getByRole("heading", { level: 1, name: "Setup status" })).toBeVisible();
  await expect(page.getByText("0115924570")).toBeVisible();
  await expect(page.getByText("wanjiruvenus980@gmail.com")).toBeVisible();
  await signOut(page, isMobile);
  // Signed out: protected pages redirect again
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("session cookie is HTTP-only", async ({ page, context }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password);
  await expect(page.getByRole("heading", { level: 1, name: "Setup status" })).toBeVisible();
  const auth = (await context.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(auth.length).toBeGreaterThan(0);
  for (const c of auth) {
    expect(c.httpOnly, c.name).toBe(true);
    expect(c.sameSite, c.name).toBe("Lax");
  }
});
