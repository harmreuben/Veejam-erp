import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Runs after the selling specs, which create product E2E-SALE. Buying more of it
// here doesn't affect them because this file sorts after them.
const SUPPLIER = "E2E Mars Kenya";

test.describe.configure({ mode: "serial" });

const settled = (page: Page) => page.waitForURL((u) => !u.pathname.startsWith("/login"));

test("owner adds a supplier", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/suppliers/new");
  await settled(page);
  await page.getByLabel("Business name").fill(SUPPLIER);
  await page.getByLabel("Payment terms (days)").fill("30");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(SUPPLIER) })).toBeVisible();
});

test("owner records a stock purchase on credit, then pays it; the books balance", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/stock-purchases/new");
  await settled(page);
  await page.goto("/stock-purchases/new");
  const supplier = page.getByLabel("Supplier", { exact: true });
  await supplier.selectOption({ label: SUPPLIER });
  await page.getByLabel("Supplier's invoice or receipt number").fill("mke-1001");
  const product = page.getByLabel("Line 1 product");
  await product.selectOption(
    (await product.locator("option", { hasText: "E2E-SALE" }).getAttribute("value"))!,
  );
  await page.getByLabel("Line 1 unit").selectOption("CARTON");
  await page.getByLabel("Line 1 quantity").fill("2");
  await page.getByLabel("Line 1 cost per unit").fill("1500");
  await expect(page.getByText("Stock cost:")).toContainText("KES 3,000.00");
  await page.getByText("Not paid yet (owed to the supplier)").click();
  await page.getByRole("button", { name: "Record purchase" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /GRN-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "recorded." })).toContainText(
    "owed to the supplier",
  );
  await expect(page.getByText("MKE-1001").first()).toBeVisible();
  // VAT-registered: 16% on top, recoverable.
  await expect(page.getByRole("row", { name: /^Total/ })).toContainText("KES 3,480.00");

  await page.getByRole("link", { name: "Pay the supplier" }).click();
  await expect(page.getByLabel("Amount paid (KES)")).toHaveValue("3480.00");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /SPAY-\d{6}/ })).toBeVisible();

  await page.goto("/stock-purchases");
  await expect(page.getByRole("row", { name: /MKE-1001/ })).toContainText("Paid");
});

test("the books balance and the owner sets the opening cost of older stock", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/accounting");
  await settled(page);
  await page.goto("/accounting");
  const start = page.getByRole("button", { name: "Start the books" });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
  await expect(page.getByRole("row", { name: /Totals/ })).not.toContainText("do not balance");
  await expect(page.getByRole("row", { name: /2050 Goods received, not yet billed/ })).not.toContainText(
    "KES",
  );

  // 400 pieces at 7.50 averaged with 400 that had no cost; the owner sets the opening cost.
  await page.goto("/reports/stock");
  const row = page.getByRole("row", { name: /E2E-SALE/ });
  await expect(row).toContainText("KES 3.75");
  await row.getByRole("button", { name: "Change" }).click();
  await page.getByLabel("Cost per piece (KES)").fill("7.5");
  await page.getByText("This is opening stock").click();
  await page.getByLabel("Where the cost comes from").fill("Mars invoice, September");
  await expect(page.getByText("Stock value: KES 6,000.00")).toBeVisible();
  await page.getByRole("button", { name: "Save cost" }).click();
  await expect(row).toContainText("KES 7.50");
  await expect(row).toContainText("KES 6,000.00");
});
