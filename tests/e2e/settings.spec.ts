import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/company");
  await expect(page.getByRole("heading", { level: 1, name: "Company settings" })).toBeVisible();
});

test("owner saves company settings; they persist and show who changed them", async ({ page }) => {
  await page.getByLabel("KRA PIN").fill("p051234567x");
  await page.getByLabel("Payment instructions").fill("M-Pesa Till 123456\nEquity Bank, account on request");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Company settings saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("KRA PIN")).toHaveValue("P051234567X");
  await expect(page.getByLabel("Payment instructions")).toHaveValue(/M-Pesa Till 123456/);
  await expect(page.getByText(/Last changed .* by Venus Owner/)).toBeVisible();
});

test("invalid values are rejected on the server with field messages", async ({ page }) => {
  await page.getByLabel("KRA PIN").fill("12345");
  await page.getByLabel("Telephone").fill("123");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("A KRA PIN is a letter, 9 digits and a letter")).toBeVisible();
  await expect(page.getByText(/Enter a Kenyan number/)).toBeVisible();
  await expect(page.getByLabel("KRA PIN")).toHaveAttribute("aria-invalid", "true");
});

test("two people editing at once: the second save is refused, not silently overwritten", async ({
  page,
  browser,
}) => {
  const other = await browser.newPage();
  await signIn(other, E2E_USERS.owner.email, E2E_USERS.owner.password, "/settings/company");
  await other.getByLabel("Postal address").fill("P.O. Box 1, Nairobi");
  await other.getByRole("button", { name: "Save changes" }).click();
  await expect(other.getByText("Company settings saved")).toBeVisible();
  await other.close();

  await page.getByLabel("Postal address").fill("P.O. Box 999, Ruiru");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Someone else changed these settings").first()).toBeVisible();
});
