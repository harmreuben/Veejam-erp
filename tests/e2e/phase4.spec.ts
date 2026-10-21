import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Illustrative test data; pack sizes and prices are not real Wrigley data.
const SKU = "E2E-SALE";
const NAME = "E2E Sale Gum";
const CUSTOMER = "E2E Sales Customer";

test.describe.configure({ mode: "serial" });

async function asOwner(page: Page, next = "/") {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, next);
}

async function chooseLine(page: Page, unit: string, quantity: string) {
  await page.getByLabel("Line 1 product").selectOption({ label: `${NAME} (${SKU})` });
  await page.getByLabel("Line 1 unit").selectOption(unit);
  await page.getByLabel("Line 1 quantity").fill(quantity);
}

async function chooseCustomer(page: Page) {
  const select = page.getByLabel("Customer", { exact: true });
  const value = await select.locator("option", { hasText: CUSTOMER }).getAttribute("value");
  await select.selectOption(value!);
}

test("owner sets up a product, stock and a credit customer", async ({ page }) => {
  await asOwner(page, "/products/new");
  await page.getByLabel("SKU code").fill(SKU);
  await page.getByLabel("Name", { exact: true }).fill(NAME);
  await page.getByLabel("Brand").fill("TestBrand");
  await page.getByLabel("Category", { exact: true }).fill("Chewing gum");
  await page.getByLabel("Pieces per pack").fill("10");
  await page.getByLabel("Packs per carton").fill("20");
  await page.getByLabel("Price per piece (KES)").fill("12");
  await page.getByLabel("Price per carton (KES)").fill("2000");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();

  await page.goto("/inventory/adjustments/new");
  await page.getByLabel("Reason").selectOption("OPENING_BALANCE");
  await chooseLine(page, "CARTON", "3");
  await page.getByRole("button", { name: "Post adjustment" }).click();
  await expect(page.getByText("+3 cartons")).toBeVisible();

  await page.goto("/customers/new");
  await page.getByLabel("Business name").fill(CUSTOMER);
  await page.getByLabel("Credit limit (KES)").fill("10000");
  await page.getByLabel("Payment terms (days)").fill("7");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(CUSTOMER) })).toBeVisible();

  await page.goto("/settings/tax");
  await expect(page.getByLabel("Rate (%)").first()).toHaveValue("16");
});

test("sales: quotation → sales order (stock reserved) → invoice posted; stock leaves", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/quotations/new");
  await chooseCustomer(page);
  await chooseLine(page, "CARTON", "2");
  // Sales can't give discounts: there is no discount box.
  await expect(page.getByLabel("Line 1 discount percent")).toHaveCount(0);
  await expect(page.getByText("= 400 pcs (2 ctn).")).toBeVisible();
  await expect(page.getByText("KES 4,000.00").first()).toBeVisible();
  await expect(page.getByText("KES 551.72")).toBeVisible(); // VAT inside 4,000 at 16%
  await page.getByRole("button", { name: "Save quotation" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /QUO-\d{6}/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark sent" }).click();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Make sales order" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /SO-\d{6}/ })).toBeVisible();
  await page.getByRole("button", { name: "Confirm order…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm and reserve stock" }).click();
  await expect(page.getByText(/Stock for this order is reserved/)).toBeVisible();

  await page.getByRole("button", { name: "Make invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Draft invoice/ })).toBeVisible();
  await expect(page.getByText(/no invoice number yet/)).toBeVisible();
  await page.getByRole("button", { name: "Post invoice…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("KES 4,000.00");
  await dialog.getByRole("button", { name: "Post invoice" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /INV-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "posted." })).toContainText(
    "can no longer be changed",
  );
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  // The PDF opens for signed-in staff.
  const pdfHref = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.goto("/inventory");
  await expect(page.getByRole("row", { name: new RegExp(NAME) })).toContainText("200 pcs (1 ctn)");
});

test("a second invoice for more than is left is refused with the reason", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/invoices/new");
  await chooseCustomer(page);
  await chooseLine(page, "CARTON", "2");
  await expect(page.getByText(/not enough for this line/)).toBeVisible();
  await page.getByRole("button", { name: "Save draft invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft invoice" })).toBeVisible();
  await page.getByRole("button", { name: "Post invoice…" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "Post invoice" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Not enough stock");
  await expect(dialog.getByRole("alert")).toContainText("has 200 pcs (1 ctn), this needs 400 pcs (2 ctn)");
});

test("owner shares the invoice; the link opens without signing in until revoked", async ({
  page,
  browser,
}) => {
  await asOwner(page, "/invoices?status=POSTED");
  await page
    .getByRole("link", { name: /INV-\d{6}/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Create share link" }).click();
  const url = (await page.getByTestId("share-url").textContent())!;
  expect(url).toMatch(/\/d\/[A-Za-z0-9_-]{43}$/);

  const stranger = await browser.newContext();
  const res = await stranger.request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");

  await page.reload();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(/revoked/)).toBeVisible();
  const after = await stranger.request.get(url);
  expect(after.status()).toBe(404);
  expect(await after.text()).toContain("expired or is no longer valid");
  await stranger.close();
});

test("storekeeper makes the delivery note, dispatches and records delivery", async ({ page }) => {
  await signIn(page, E2E_USERS.storekeeper.email, E2E_USERS.storekeeper.password, "/invoices?status=POSTED");
  await page
    .getByRole("link", { name: /INV-\d{6}/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Post invoice…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Make delivery note" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /DN-\d{6}/ })).toBeVisible();
  await page.getByRole("button", { name: "Dispatch…" }).click();
  await page.getByLabel("Vehicle (registration)").fill("KDA 123A");
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark dispatched" }).click();
  await expect(page.getByText("Dispatched", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Mark delivered…" }).click();
  await page.getByLabel("Received by").fill("Shop owner");
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Shop owner")).toBeVisible();
});
