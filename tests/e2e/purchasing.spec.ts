import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Runs after the selling specs, which create product E2E-SALE. Buying more of it
// here doesn't affect them because this file sorts after them.
const SUPPLIER = "E2E Mars Kenya";

test.describe.configure({ mode: "serial" });

const settled = (page: Page) => page.waitForURL((u) => !u.pathname.startsWith("/login"));

async function openOrder(page: Page) {
  await page.goto("/purchase-orders?status=ALL");
  await page
    .getByRole("row", { name: new RegExp(SUPPLIER) })
    .getByRole("link", { name: /PO-\d{6}/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /PO-\d{6}/ })).toBeVisible();
}

test("owner adds a supplier and sends a purchase order", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/suppliers/new");
  await settled(page);
  await page.getByLabel("Business name").fill(SUPPLIER);
  await page.getByLabel("Payment terms (days)").fill("30");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(SUPPLIER) })).toBeVisible();

  await page.getByRole("link", { name: "New purchase order" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New purchase order" })).toBeVisible();
  const product = page.getByLabel("Line 1 product");
  await product.selectOption(
    (await product.locator("option", { hasText: "E2E-SALE" }).getAttribute("value"))!,
  );
  await page.getByLabel("Line 1 unit").selectOption("CARTON");
  await page.getByLabel("Line 1 quantity").fill("3");
  await page.getByLabel("Line 1 cost per unit").fill("1500");
  await expect(page.getByText("Total", { exact: true }).locator("..")).toContainText("KES 5,220.00");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /PO-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("saved");
  const pdf = await page.request.get((await page.getByRole("link", { name: "PDF" }).getAttribute("href"))!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  await page.getByRole("button", { name: "Mark as ordered" }).click();
  await expect(page.getByText("Ordered", { exact: true })).toBeVisible();
});

test("the storekeeper receives part of the order without seeing costs", async ({ page }) => {
  await signIn(page, E2E_USERS.storekeeper.email, E2E_USERS.storekeeper.password, "/purchase-orders");
  await settled(page);
  await openOrder(page);
  await expect(page.getByRole("columnheader", { name: "Cost per unit" })).toHaveCount(0);
  await page.getByRole("link", { name: "Receive goods" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Receive goods" })).toBeVisible();
  await page.getByLabel(/quantity arrived/).fill("2");
  await page.getByLabel("Supplier's delivery note or invoice number").fill("dn-4471");
  await page.getByRole("button", { name: "Post goods received" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /GRN-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "posted" })).toContainText("The stock is in");
  // E2E-SALE was already in stock from the selling tests, with no cost.
  await expect(page.getByText("already in stock with no cost")).toBeVisible();
  await expect(page.getByText("Value at cost")).toHaveCount(0);
  await openOrder(page);
  await expect(page.getByText("Partly received", { exact: true })).toBeVisible();

  // Bills and payments aren't for storekeepers.
  await page.goto("/supplier-bills");
  await expect(page.getByRole("heading", { name: /don't have access/ })).toBeVisible();
});

test("owner enters the supplier's bill and pays it; the books balance", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/goods-received");
  await settled(page);
  await page.goto("/goods-received");
  await page
    .getByRole("row", { name: new RegExp(SUPPLIER) })
    .getByRole("link", { name: /GRN-\d{6}/ })
    .click();
  await expect(page.getByText("KES 3,000.00").first()).toBeVisible();
  await page.getByRole("link", { name: "Enter the supplier's bill" }).click();

  await page.getByLabel("Supplier's invoice number").fill("mke-1001");
  await expect(page.getByLabel(/amount excluding VAT/)).toHaveValue("3000.00");
  await expect(page.getByLabel(/^GRN-\d{6} VAT$/)).toHaveValue("480.00");
  await expect(page.getByText("Bill total").locator("..")).toContainText("KES 3,480.00");
  await page.getByRole("button", { name: "Enter bill" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /BILL-\d{6}/ })).toBeVisible();
  await expect(page.getByText("MKE-1001").first()).toBeVisible();
  await page.getByRole("link", { name: "Pay this bill" }).click();
  await expect(page.getByLabel("Amount paid (KES)")).toHaveValue("3480.00");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /SPAY-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("recorded");

  await page.goto("/supplier-bills?status=ALL");
  await expect(page.getByRole("row", { name: /MKE-1001/ })).toContainText("Paid");

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
