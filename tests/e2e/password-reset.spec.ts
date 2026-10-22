import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS, MOCK_AUTH_PORT } from "./support/fixtures.mjs";

test.describe.configure({ mode: "serial" });

const STORE = E2E_USERS.storekeeper;
const NEW_PASSWORD = "Store-new-pass-2026";

/** The newest reset email the test sign-in server "sent" to this address. */
async function latestLink(request: import("@playwright/test").APIRequestContext, to: string) {
  const res = await request.get(`http://127.0.0.1:${MOCK_AUTH_PORT}/__outbox?to=${encodeURIComponent(to)}`);
  const mails = (await res.json()) as { link: string }[];
  return mails.at(-1)?.link ?? null;
}

test("forgot password: the same answer for any address, a one-use link, a new password, others signed out", async ({
  browser,
  request,
}) => {
  // Signed in elsewhere with the old password (e.g. a lost phone).
  const lostPhone = await (await browser.newContext()).newPage();
  await signIn(lostPhone, STORE.email, STORE.password, "/inventory");
  await lostPhone.waitForURL(/\/inventory/);

  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Forgot your password?" })).toBeVisible();

  // An address with no account gets the same answer, and no email.
  await page.getByLabel("Email").fill("nobody@veejam.test");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If nobody@veejam.test has an account, a reset link is on its way",
  );
  expect(await latestLink(request, "nobody@veejam.test")).toBeNull();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(STORE.email.toUpperCase());
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("status")).toContainText(`If ${STORE.email} has an account`);
  const link = await latestLink(request, STORE.email);
  expect(link).toMatch(/\/auth\/confirm\?token_hash=[0-9a-f]+&type=recovery/);

  // Opened on another device (fresh browser): works.
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(link!);
  await expect(fresh.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
  await expect(fresh.getByText(`For ${STORE.email}.`)).toBeVisible();
  await fresh.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await fresh.getByLabel("New password again").fill("something-else-1");
  await fresh.getByRole("button", { name: "Save new password" }).click();
  await expect(fresh.getByText("The two passwords don't match")).toBeVisible();
  await fresh.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await fresh.getByLabel("New password again").fill(NEW_PASSWORD);
  await fresh.getByRole("button", { name: "Save new password" }).click();
  await expect(fresh.getByRole("heading", { level: 1, name: "Stock levels" })).toBeVisible();

  // The link works once.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link!);
  await expect(again.getByText("That reset link has expired or was already used")).toBeVisible();

  // The lost phone is signed out; the old password no longer works; the new one does.
  await lostPhone.goto("/inventory");
  await expect(lostPhone).toHaveURL(/\/login/);
  const check = await (await browser.newContext()).newPage();
  await check.goto("/login");
  await check.getByLabel("Email").fill(STORE.email);
  await check.getByLabel("Password").fill(STORE.password);
  await check.getByRole("button", { name: "Sign in" }).click();
  await expect(check.getByText("Email or password is incorrect.")).toBeVisible();
  await check.getByLabel("Password").fill(NEW_PASSWORD);
  await check.getByRole("button", { name: "Sign in" }).click();
  await expect(check.getByRole("heading", { level: 1, name: "Stock levels" })).toBeVisible();

  // Put the original password back for the other tests.
  await check.goto("/account");
  await check.getByLabel("Current password").fill(NEW_PASSWORD);
  await check.getByLabel("New password", { exact: true }).fill(STORE.password);
  await check.getByLabel("Repeat new password").fill(STORE.password);
  await check.getByRole("button", { name: "Change password" }).click();
  await expect(check.getByText("Password changed")).toBeVisible();
});

test("the new-password page can't be used from an ordinary signed-in screen", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/reset-password");
  await expect(page.getByText(/wasn't started from a reset link/)).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("the owner emails a staff member a reset link; signing out only signs out this device", async ({
  browser,
  page,
  request,
}) => {
  const other = await (await browser.newContext()).newPage();
  await signIn(other, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await other.waitForURL(/\/dashboard/);

  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/users");
  await page.waitForURL(/\/settings\/users/);
  await page.getByRole("button", { name: `Email ${E2E_USERS.sales.fullName} a password reset link` }).click();
  await expect(page.getByText(`Reset link emailed to ${E2E_USERS.sales.email}`)).toBeVisible();
  expect(await latestLink(request, E2E_USERS.sales.email)).toContain("/auth/confirm?token_hash=");

  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await other.goto("/dashboard");
  await expect(other.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});
