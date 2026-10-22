import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

test("owner's speed check measures the server, the database, sign-in and the browser", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/speed");
  await expect(page.getByRole("heading", { level: 1, name: "Speed check" })).toBeVisible();
  await expect(page.getByText("Database step")).toBeVisible();
  await expect(page.getByText(/Four tries: \d+, \d+, \d+, \d+ ms/)).toBeVisible();
  await expect(page.getByText(/A round trip from this device to the app takes about \d+ ms/)).toBeVisible();
  // Every signed-in page reports the sign-in check's time to the browser's developer tools.
  const res = await page.request.get("/dashboard");
  expect(res.headers()["server-timing"]).toMatch(/^signin;dur=\d+;desc="Sign-in check/);
});

test("sales staff can't open the speed check", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/settings/speed");
  await expect(page.getByRole("heading", { name: "You don't have access to the speed check" })).toBeVisible();
});
