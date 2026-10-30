import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

/*
 * The 29 screens of the Oct 2026 design handover, each mapped to its real page.
 * Every one must open for an owner with a page title and no error.
 * Detail pages are reached from their lists (the data comes from earlier tests).
 */
const SCREENS: [number, string, string][] = [
  [1, "Main ERP dashboard", "/dashboard"],
  [2, "Product catalogue", "/products"],
  [4, "Customer management", "/customers"],
  [6, "Supplier management", "/suppliers"],
  [7, "Inventory overview", "/inventory"],
  [8, "Warehouse management", "/inventory/warehouses"],
  [9, "Stock movement", "/inventory/movements"],
  [10, "Quotations", "/quotations"],
  [11, "Sales orders", "/sales-orders"],
  [12, "Invoice listing", "/invoices"],
  [13, "Invoice creation", "/invoices/new"],
  [15, "Payment management", "/payments"],
  [17, "Credit notes", "/credit-notes"],
  [18, "Sales returns", "/sales-returns"],
  [19, "General ledger", "/accounting/journal"],
  [20, "Chart of accounts", "/accounting/accounts"],
  [21, "Trial balance", "/accounting"],
  [22, "Profit and loss", "/reports/profit"],
  [23, "Financial reports", "/reports"],
  [24, "WhatsApp assistant desk", "/whatsapp"],
  [25, "WhatsApp settings", "/whatsapp/number"],
  [26, "User management", "/settings/users"],
  [27, "Roles and permissions", "/settings/roles"],
  [28, "Audit logs", "/audit"],
  [29, "Company settings", "/settings/company"],
];

async function opens(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByText(/Application error|This page couldn.t load/)).toHaveCount(0);
}

/** Open a list and follow its first link matching `name` (a detail page). */
async function firstDetail(page: Page, list: string, name: RegExp) {
  await page.goto(list);
  const link = page.getByRole("main").getByRole("link", { name }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  await opens(page, href);
  return href;
}

test("all 29 handover screens open on their real pages", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await page.waitForURL(/\/dashboard$/);
  for (const [, , path] of SCREENS) await opens(page, path);

  // 3 Product details, 5 Customer profile, 16 Payment receipt.
  await firstDetail(page, "/products", /E2E/);
  await firstDetail(page, "/customers", /E2E/);
  await firstDetail(page, "/payments", /^RCT-/);

  // 14 Invoice preview (A4): the same figures as the invoice, and only the paper prints.
  const invoice = await firstDetail(page, "/invoices?status=POSTED", /^INV-\d+$/);
  const total = (await page.getByText(/^KES [\d,]+\.\d\d$/).first().textContent())!;
  await page.getByRole("link", { name: "Print preview" }).click();
  const paper = page.getByRole("article");
  await expect(paper).toContainText("TAX INVOICE");
  await expect(paper).toContainText(total);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Modules" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(paper).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  expect(page.url()).toContain(`/documents/${invoice.split("/").pop()}/preview`);
});

test("every menu link opens a page", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await page.waitForURL(/\/dashboard$/);
  const hrefs = await page
    .getByRole("navigation", { name: "Modules" })
    .getByRole("link")
    .evaluateAll((links) => links.map((a) => a.getAttribute("href")!));
  expect(hrefs.length).toBeGreaterThan(25);
  for (const href of hrefs) await opens(page, href);
});
