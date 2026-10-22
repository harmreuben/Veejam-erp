import { expect, test } from "@playwright/test";

import { formAlert, signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

test("wrong password shows one generic message", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, "not-the-password");
  await expect(formAlert(page)).toHaveText("Email or password is incorrect.");
  await signIn(page, "nobody@veejam.test", "whatever-123");
  await expect(formAlert(page)).toHaveText("Email or password is incorrect.");
});

test("a Supabase account without ERP access can't get in", async ({ page }) => {
  await signIn(page, E2E_USERS.stranger.email, E2E_USERS.stranger.password);
  await expect(formAlert(page)).toContainText("hasn't been given access");
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("a crafted next link can't send users to another site", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "https://evil.example/phish");
  await expect(page).toHaveURL("http://localhost:3100/dashboard");
});

test("sales staff see only what their role allows", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password);
  // No dashboard for sales by default: they start on invoices.
  await expect(page).toHaveURL(/\/invoices$/);

  const nav = page.getByRole("navigation", { name: "Modules" }).filter({ visible: true });
  await expect(nav.getByRole("link", { name: "Company settings" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Users & roles" })).toHaveCount(0);

  // Read-only settings: no save button, fields not editable
  await page.goto("/settings/company");
  await expect(page.getByText("Only an owner or administrator can change them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByLabel("Company name")).toHaveAttribute("readonly", "");

  // Typing the address directly doesn't help
  await page.goto("/settings/users");
  await expect(page.getByRole("heading", { name: "You don't have access to users and roles" })).toBeVisible();
});
