import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

/*
 * The 13 menu sections of VeeJam v2 (Nov 2026) and the pages inside them.
 * Every one must open for an owner with a page title and no error. Detail pages
 * are reached from their lists (the data comes from earlier tests).
 */
const SCREENS: [string, string][] = [
  ["Dashboard", "/dashboard"],
  ["Products", "/products"],
  ["Price lists", "/price-lists"],
  ["Inventory", "/inventory"],
  ["Warehouses", "/inventory/warehouses"],
  ["Stock movements", "/inventory/movements"],
  ["Customers", "/customers"],
  ["Suppliers", "/suppliers"],
  ["Stock purchases", "/stock-purchases"],
  ["Record a stock purchase", "/stock-purchases/new"],
  ["Supplier payments", "/supplier-payments"],
  ["Sales", "/sales"],
  ["Credit notes", "/credit-notes"],
  ["Sales returns", "/sales-returns"],
  ["Invoices", "/invoices"],
  ["New invoice", "/invoices/new"],
  ["Payments", "/payments"],
  ["Customer balances", "/payments/balances"],
  ["Financial reports", "/reports"],
  ["Profit and loss", "/reports/profit"],
  ["Trial balance", "/accounting"],
  ["Chart of accounts", "/accounting/accounts"],
  ["Journal", "/accounting/journal"],
  ["WhatsApp assistant", "/whatsapp"],
  ["WhatsApp settings", "/whatsapp/number"],
  ["Company settings", "/settings/company"],
  ["Users", "/settings/users"],
  ["Audit log", "/audit"],
];

/** Pages that were removed in Nov 2026: they no longer exist. */
const REMOVED = [
  "/quotations",
  "/sales-orders",
  "/deliveries",
  "/purchase-orders",
  "/goods-received",
  "/supplier-bills",
  "/settings/roles",
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

test("every section and its pages open; removed pages are gone", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await page.waitForURL(/\/dashboard$/);
  for (const [, path] of SCREENS) await opens(page, path);
  for (const path of REMOVED) expect((await page.goto(path))?.status(), path).toBe(404);

  // 3 Product details, 5 Customer profile, 16 Payment receipt.
  await firstDetail(page, "/products", /E2E/);
  await firstDetail(page, "/customers", /E2E/);
  await firstDetail(page, "/payments", /^RCT-/);
  await firstDetail(page, "/stock-purchases", /^GRN-/);

  // 14 Invoice preview (A4): the same figures as the invoice, and only the paper prints.
  const invoice = await firstDetail(page, "/invoices?status=POSTED", /^INV-\d+$/);
  const total = (await page
    .getByText(/^KES [\d,]+\.\d\d$/)
    .first()
    .textContent())!;
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
  // 11 sections, all linked (Expenses and Business Funds were dropped from the plan).
  expect(hrefs).toHaveLength(11);
  await expect(page.getByRole("navigation", { name: "Modules" }).getByText("Soon")).toHaveCount(0);
  for (const href of hrefs) await opens(page, href);
});
