import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Runs after the batch spec, which leaves posted invoices for "E2E Sales Customer".
const CUSTOMER = "E2E Sales Customer";

test.describe.configure({ mode: "serial" });

test("sales staff don't get a Delete button", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/invoices?status=POSTED");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/invoices?status=POSTED");
  await page
    .getByRole("row", { name: new RegExp(CUSTOMER) })
    .getByRole("link", { name: /INV-\d{6}/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /INV-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete…" })).toHaveCount(0);
});

test("the owner deletes an invoice: it leaves the lists and stays under Deleted", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/invoices?status=POSTED");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/invoices?status=POSTED");
  const link = page
    .getByRole("row", { name: new RegExp(CUSTOMER) })
    .getByRole("link", { name: /INV-\d{6}/ })
    .first();
  const number = (await link.textContent())!.trim();
  await link.click();
  await page.getByRole("button", { name: "Delete…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Everything this invoice did is undone");
  await expect(dialog.getByLabel("The goods are back in stock (or never left)")).toBeChecked();
  // A reason is required (the browser won't send the form without one).
  await expect(dialog.getByLabel("Why is it being deleted?")).toHaveAttribute("required", "");
  await dialog.getByLabel("Why is it being deleted?").fill("Entered twice by mistake");
  await dialog.getByRole("button", { name: "Delete invoice" }).click();

  await expect(page.getByRole("status").filter({ hasText: "Deleted" })).toContainText(
    "Entered twice by mistake",
  );
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

  await page.goto("/invoices?status=ALL");
  await expect(page.getByRole("link", { name: number, exact: true })).toHaveCount(0);
  await page.goto("/invoices?status=DELETED");
  await expect(page.getByRole("link", { name: number, exact: true })).toBeVisible();
});

test("the owner deletes a payment; its M-Pesa code can be used again", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/payments/new");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const record = async () => {
    await page.goto("/payments/new");
    const select = page.getByLabel("Customer", { exact: true });
    await select.selectOption((await select.locator("option", { hasText: CUSTOMER }).getAttribute("value"))!);
    await page.getByLabel("Amount received (KES)").fill("250");
    await page.getByLabel("How they paid").selectOption("MPESA");
    await page.getByLabel("M-Pesa code").fill("DEL1T3ME99");
    await page.getByRole("button", { name: "Record payment" }).click();
  };
  await record();
  const heading = page.getByRole("heading", { level: 1, name: /RCT-\d{6}/ });
  await expect(heading).toBeVisible();
  const number = (await heading.textContent())!.match(/RCT-\d{6}/)![0];

  await page.getByRole("button", { name: "Delete…" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Why is it being deleted?").fill("Recorded on the wrong customer");
  await dialog.getByRole("button", { name: "Delete payment" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Recorded on the wrong customer" })).toContainText(
    "Deleted",
  );

  await page.goto("/payments");
  await expect(page.getByRole("link", { name: number })).toHaveCount(0);
  await record();
  await expect(page.getByRole("heading", { level: 1, name: /RCT-\d{6}/ })).not.toContainText(number);
});
