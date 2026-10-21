import { expect, test } from "@playwright/test";

import { formAlert, signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

const NEW = { name: "Grace Storekeeper", email: "grace@veejam.test", password: "Grace-temp-2026" };

test("owner adds a user, who signs in, changes password, and is then deactivated", async ({
  page,
  browser,
}) => {
  // Owner adds Grace
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users & roles" })).toBeVisible();
  await page.getByLabel("Full name").fill(NEW.name);
  await page.getByLabel("Email", { exact: true }).fill(NEW.email);
  await page.getByLabel("Role", { exact: true }).selectOption("STOREKEEPER");
  await page.getByLabel("Temporary password").fill(NEW.password);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByText(`${NEW.name} can now sign in as Storekeeper`)).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(NEW.name) });
  await expect(row).toBeVisible();

  // Grace signs in with the temporary password and changes it
  const grace = await browser.newPage();
  await signIn(grace, NEW.email, NEW.password);
  await expect(grace.getByRole("heading", { level: 1, name: "Setup status" })).toBeVisible();
  await grace.goto("/account");
  await grace.getByLabel("Current password").fill(NEW.password);
  await grace.getByLabel("New password", { exact: true }).fill("Grace-own-pass-2026");
  await grace.getByLabel("Repeat new password").fill("Grace-own-pass-2026");
  await grace.getByRole("button", { name: "Change password" }).click();
  await expect(grace.getByText("Password changed")).toBeVisible();

  // Owner changes her role, then deactivates her (with confirmation)
  await row.getByLabel(`Role for ${NEW.name}`).selectOption("SALES");
  await expect(page.getByText(`${NEW.name} is now Sales`)).toBeVisible();
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(`Deactivate ${NEW.name}?`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText(`${NEW.name} can no longer sign in`)).toBeVisible();
  await expect(row.getByText("Deactivated")).toBeVisible();

  // Grace's very next click takes her out, and she can't sign back in
  await grace.goto("/account");
  await expect(grace).toHaveURL(/\/login\?reason=deactivated/);
  await expect(grace.getByText("This account has been deactivated")).toBeVisible();
  await signIn(grace, NEW.email, "Grace-own-pass-2026");
  await expect(formAlert(grace)).toContainText("deactivated");
  await expect(grace).toHaveURL(/\/login/);

  await grace.close();

  // Reactivate: she can sign in again (fresh browser, new password)
  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText(`${NEW.name} can sign in again`)).toBeVisible();
  const fresh = await browser.newContext();
  const again = await fresh.newPage();
  await signIn(again, NEW.email, "Grace-own-pass-2026");
  await expect(again.getByRole("heading", { level: 1, name: "Setup status" })).toBeVisible();
  // The temporary password no longer works
  await fresh.clearCookies();
  await signIn(again, NEW.email, NEW.password);
  await expect(formAlert(again)).toHaveText("Email or password is incorrect.");
  await fresh.close();
});

test("the owner can't remove their own access", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/users");
  const me = page.getByRole("row", { name: /\(you\)/ });
  await expect(me).toBeVisible();
  await expect(me.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  await expect(me.getByRole("combobox")).toHaveCount(0);
});
