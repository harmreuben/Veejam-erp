import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Runs after the selling and buying specs: product E2E-SALE and "E2E Sales Customer" exist.
const CUSTOMER = "E2E Sales Customer";
const PRODUCT = "E2E Sale Gum (E2E-SALE)";

async function fillCard(page: Page, n: number, unit: string, quantity: string) {
  const customer = page.getByLabel(`Invoice ${n} customer`, { exact: true });
  await customer.selectOption(
    (await customer.locator("option", { hasText: CUSTOMER }).getAttribute("value"))!,
  );
  await page.getByLabel(`Invoice ${n} line 1 product`).selectOption({ label: PRODUCT });
  await page.getByLabel(`Invoice ${n} line 1 unit`).selectOption(unit);
  await page.getByLabel(`Invoice ${n} line 1 quantity`).fill(quantity);
}

test("sales posts a batch of invoices; one that can't post stays a draft with the reason", async ({
  page,
}) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/invoices");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/invoices");
  await page.getByRole("link", { name: "Batch of invoices" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Batch of invoices" })).toBeVisible();

  await fillCard(page, 1, "CARTON", "1");
  await page.getByLabel("Invoice 1 customer's LPO number").fill("LPO-BATCH-1");
  await fillCard(page, 2, "CARTON", "999");
  await expect(page.getByText(/not enough; this invoice will stay a draft/)).toBeVisible();
  // Every invoice shows its price as it's entered.
  await expect(page.getByText("No price for this unit")).toHaveCount(0);
  await page.getByRole("button", { name: "Add another customer" }).click();
  await fillCard(page, 3, "CARTON", "1");
  await page.getByRole("button", { name: "Post 3 invoices" }).click();

  const results = page
    .getByRole("region", { name: /Last batch/ })
    .or(page.locator("section", { hasText: "Last batch" }));
  await expect(results).toContainText("Last batch: 2 posted, 1 kept as draft");
  // 999 cartons is over the customer's credit limit (and the stock): kept as a draft with the reason.
  await expect(results).toContainText(/not posted: (Credit check failed|Not enough stock)/);
  await expect(results.getByRole("link", { name: /INV-\d{6}/ })).toHaveCount(2);

  // The posted ones are cleared; the form is ready for the next batch.
  await expect(page.getByLabel("Invoice 2 customer", { exact: true })).toHaveCount(0);
  await results
    .getByRole("link", { name: /INV-\d{6}/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /INV-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("LPO-BATCH-1");
});
