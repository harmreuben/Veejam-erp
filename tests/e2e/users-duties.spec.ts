import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

test.describe.configure({ mode: "serial" });

const SALES = E2E_USERS.sales.fullName;

test("owner switches a sales person's duties; it applies on their next click", async ({ browser }) => {
  const ownerPage = await (await browser.newContext()).newPage();
  await signIn(ownerPage, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/users");
  await ownerPage.waitForURL((u) => !u.pathname.startsWith("/login"));
  await ownerPage.goto("/settings/users");
  await ownerPage.getByRole("link", { name: `Duties for ${SALES}` }).click();
  await expect(ownerPage.getByRole("heading", { level: 1, name: `${SALES}'s duties` })).toBeVisible();
  await expect(ownerPage.getByText("Same as every Sales.")).toBeVisible();

  // WhatsApp commands stay with owners.
  await expect(ownerPage.getByLabel("Run ERP commands from WhatsApp")).toBeDisabled();

  // Ticking "Reverse customer payments" needs "Record customer payments", already on.
  await ownerPage.getByLabel("Record customer payments").uncheck();
  await ownerPage.getByLabel("Give discounts").check();
  await expect(ownerPage.getByText("1 more than a Sales · 1 fewer than a Sales")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Save duties" }).click();
  await expect(ownerPage.getByText(/applies from their next click/)).toBeVisible();

  await ownerPage.goto("/settings/users");
  await expect(ownerPage.getByRole("row", { name: new RegExp(SALES) })).toContainText("Customised");

  // The sales person no longer records payments, and sees their new duties.
  const salesPage = await (await browser.newContext()).newPage();
  await signIn(salesPage, E2E_USERS.sales.email, E2E_USERS.sales.password, "/payments/new");
  await salesPage.waitForURL((u) => !u.pathname.startsWith("/login"));
  await salesPage.goto("/payments/new");
  await expect(
    salesPage.getByRole("heading", { name: "You don't have access to recording payments" }),
  ).toBeVisible();
  await salesPage.goto("/account");
  await expect(salesPage.getByRole("main")).toContainText("Give discounts");
  await expect(salesPage.getByRole("main")).not.toContainText("Record customer payments");

  // Back to the role's defaults (other tests rely on them).
  await ownerPage.getByRole("link", { name: `Duties for ${SALES}` }).click();
  await ownerPage.getByRole("button", { name: "Back to Sales defaults" }).click();
  await expect(ownerPage.getByText("Same as every Sales.")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Save duties" }).click();
  await expect(ownerPage.getByText(/applies from their next click/)).toBeVisible();
  await salesPage.goto("/payments/new");
  await expect(salesPage.getByRole("heading", { level: 1, name: "Record payment" })).toBeVisible();
});

test("sales staff can't open anyone's duties to change them", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/settings/users");
  await expect(page.getByRole("heading", { name: "You don't have access to users and roles" })).toBeVisible();
});
