import { expect, test } from "@playwright/test";

import { formAlert, signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

const SUE = E2E_USERS.storekeeper;

// Runs last on desktop: it leaves the storekeeper deactivated.
test("two people at most: no room to add a third; a deactivated user is signed out at once", async ({
  page,
  browser,
}) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  // The test database has more than two active people, so there is no room.
  await expect(page.getByText("Both places are taken")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add user" })).toHaveCount(0);

  // Sue is signed in on another device.
  const sue = await browser.newPage();
  await signIn(sue, SUE.email, SUE.password);
  await sue.waitForURL((u) => !u.pathname.startsWith("/login"));

  // The owner deactivates her (with confirmation)…
  const row = page.getByRole("row", { name: new RegExp(SUE.fullName) });
  await row.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(`Deactivate ${SUE.fullName}?`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText(`${SUE.fullName} can no longer sign in`)).toBeVisible();
  await expect(row.getByText("Deactivated")).toBeVisible();

  // …and Sue's very next click takes her out; she can't sign back in.
  await sue.goto("/account");
  await expect(sue).toHaveURL(/\/login\?reason=deactivated/);
  await signIn(sue, SUE.email, SUE.password);
  await expect(formAlert(sue)).toContainText("deactivated");
  await sue.close();

  // Reactivating her would make more than two active people: refused, with the reason.
  await row.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByText(/room for 2 people/)).toBeVisible();
  await expect(row.getByText("Deactivated")).toBeVisible();
});

test("the owner can't remove their own access", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/users");
  const me = page.getByRole("row", { name: /\(you\)/ });
  await expect(me).toBeVisible();
  await expect(me.getByRole("button", { name: "Deactivate" })).toHaveCount(0);
  await expect(me.getByRole("combobox")).toHaveCount(0);
});
