import { expect, test, type Page } from "@playwright/test";

import { formAlert, signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Illustrative test product; pack sizes are not real Wrigley data.
const SKU = "E2E-001";
const NAME = "E2E Test Mint 10s";

async function asOwner(page: Page, next = "/") {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, next);
}

test.describe.configure({ mode: "serial" });

test("owner adds a product with prices", async ({ page }) => {
  await asOwner(page, "/products/new");
  await expect(page.getByRole("heading", { level: 1, name: "Add product" })).toBeVisible();
  await page.getByLabel("SKU code").fill("e2e-001");
  await page.getByLabel("Name", { exact: true }).fill(NAME);
  await page.getByLabel("Brand").fill("TestBrand");
  await page.getByLabel("Category", { exact: true }).fill("Chewing gum");
  await page.getByLabel("Pieces per pack").fill("10");
  await page.getByLabel("Packs per carton").fill("20");
  await expect(page.getByText("10 pcs/pack · 20 packs/carton · 200 pcs/carton")).toBeVisible();
  await page.getByLabel("Cost per piece (KES, excl. VAT)").fill("6.40");
  await page.getByLabel("Price per piece (KES)").fill("10");
  await page.getByLabel("Price per carton (KES)").fill("1,900");
  await page.getByRole("button", { name: "Add product" }).click();

  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByText(`${SKU} · TestBrand · Chewing gum`)).toBeVisible();
  const prices = page.getByRole("row", { name: /Standard prices/ });
  await expect(prices).toContainText("KES 10.00");
  await expect(prices).toContainText("KES 1,900.00");

  // Same SKU again is refused on the field
  await page.goto("/products/new");
  await page.getByLabel("SKU code").fill(SKU);
  await page.getByLabel("Name", { exact: true }).fill("Copy");
  await page.getByLabel("Brand").fill("B");
  await page.getByLabel("Category", { exact: true }).fill("C");
  await page.getByLabel("Pieces per pack").fill("1");
  await page.getByLabel("Packs per carton").fill("1");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText(`SKU ${SKU} is already used by ${NAME}`)).toBeVisible();
});

test("owner records opening stock in cartons; levels and ledger agree", async ({ page }) => {
  await asOwner(page, "/inventory/adjustments/new");
  await page.getByLabel("Reason").selectOption("OPENING_BALANCE");
  await page.getByLabel("Line 1 product").selectOption({ label: `${NAME} (${SKU})` });
  await page.getByLabel("Line 1 unit").selectOption("CARTON");
  await page.getByLabel("Line 1 quantity").fill("2");
  await expect(page.getByText("= 400 pcs (2 ctn).")).toBeVisible();
  await page.getByRole("button", { name: "Post adjustment" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "ADJ-000001" })).toBeVisible();
  await expect(page.getByText("+2 cartons")).toBeVisible();

  await page.goto("/inventory");
  await expect(page.getByRole("row", { name: new RegExp(NAME) })).toContainText("400 pcs (2 ctn)");
  await page.goto("/inventory/movements");
  await expect(page.getByRole("row", { name: /ADJ-000001/ })).toContainText("+400 pcs (2 ctn)");
});

test("removing more than is in stock is refused with the reason", async ({ page }) => {
  await asOwner(page, "/inventory/adjustments/new");
  await page.getByLabel("Reason").selectOption("DAMAGED");
  await page.getByLabel("Line 1 product").selectOption({ label: `${NAME} (${SKU})` });
  await page.getByLabel("Line 1 unit").selectOption("CARTON");
  await page.getByLabel("Line 1 quantity").fill("3");
  await page.getByRole("button", { name: "Post adjustment" }).click();
  await expect(formAlert(page)).toContainText("Not enough stock");
  await expect(formAlert(page)).toContainText("has 400 pcs (2 ctn), this needs 600 pcs (3 ctn)");
});

test("storekeeper counts; only the owner can post; stock becomes the counted figure", async ({
  page,
  browser,
}) => {
  await signIn(page, E2E_USERS.storekeeper.email, E2E_USERS.storekeeper.password, "/inventory/counts");
  await page.getByRole("button", { name: "Start count" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /CNT-000001/ })).toBeVisible();
  await page.getByLabel(`${NAME} cartons`).fill("1");
  await page.getByLabel(`${NAME} packs`).fill("5");
  await expect(page.getByRole("row", { name: new RegExp(NAME) })).toContainText("250 pcs");
  await expect(page.getByRole("button", { name: "Post count…" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save counts" }).click();
  await expect(page.getByText("Counts saved")).toBeVisible();
  const countUrl = page.url();

  const owner = await browser.newPage();
  await asOwner(owner, new URL(countUrl).pathname);
  await expect(owner.getByLabel(`${NAME} packs`)).toHaveValue("5");
  await owner.getByRole("button", { name: "Post count…" }).click();
  await owner.getByRole("alertdialog").getByRole("button", { name: "Post count" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "CNT-000001 posted." })).toContainText(
    "1 product counted; 1 balance changed to the counted figure.",
  );
  await expect(owner.getByRole("row", { name: new RegExp(NAME) })).toContainText("−150 pcs (15 pk)");
  await owner.goto("/inventory");
  await expect(owner.getByRole("row", { name: new RegExp(NAME) })).toContainText("250 pcs (1 ctn, 5 pk)");
  await owner.close();
});

test("sales adds customers: phone cleaned, duplicates flagged, credit locked", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/customers/new");
  await expect(page.getByLabel("Credit limit (KES)")).toHaveAttribute("readonly", "");
  await page.getByLabel("Business name").fill("Mama Pima Kiosk");
  await page.getByLabel("Type").selectOption("KIOSK");
  await page.getByLabel("Phone").fill("0700");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText("Enter a real Kenyan number")).toBeVisible();
  await page.getByLabel("Phone").fill("0712 345 678");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Mama Pima Kiosk/ })).toBeVisible();
  await expect(page.getByText(/CUS-000001 · Kiosk/)).toBeVisible();
  await expect(page.getByLabel("Phone")).toHaveValue("0712 345 678");

  await page.goto("/customers/new");
  await page.getByLabel("Business name").fill("mama pima  kiosk.");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText(/already exists \(CUS-000001\)/)).toBeVisible();
  await page.getByText("This is a different customer with the same name").click();
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByText(/CUS-000002/)).toBeVisible();

  // Sales sees no cost prices and can't adjust stock.
  await page.goto("/products");
  await expect(page.getByRole("columnheader", { name: "Cost / piece" })).toHaveCount(0);
  await page.goto("/inventory/adjustments/new");
  await expect(
    page.getByRole("heading", { name: "You don't have access to stock adjustments" }),
  ).toBeVisible();
});

test("owner imports customers from a CSV after reviewing it", async ({ page }) => {
  await asOwner(page, "/imports");
  await page.getByLabel("What are you importing?").selectOption("CUSTOMERS");
  await page.getByLabel("CSV file").setInputFiles({
    name: "customers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,type,phone,credit_limit\nE2E Wholesalers,Wholesaler,0723456789,50000\nE2E Shop,,07,\n",
    ),
  });
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText("1 of 2 rows have problems.")).toBeVisible();
  await expect(page.getByText(/phone: Enter a real Kenyan number/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Import these rows" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel import" }).click();
  await expect(page.getByRole("status")).toContainText(
    "This import was cancelled. Nothing from this file was saved.",
  );

  await page.goto("/imports");
  await page.getByLabel("What are you importing?").selectOption("CUSTOMERS");
  await page.getByLabel("CSV file").setInputFiles({
    name: "customers-fixed.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,type,phone,credit_limit\nE2E Wholesalers,Wholesaler,0723456789,50000\n"),
  });
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText(/All 1 rows passed/)).toBeVisible();
  await page.getByRole("button", { name: "Import these rows" }).click();
  await expect(page.getByRole("status")).toContainText("1 created, 0 updated, 0 unchanged");

  await page.goto("/customers?q=E2E");
  await expect(page.getByRole("row", { name: /E2E Wholesalers/ })).toContainText("KES 50,000.00");
});

test("owner edits prices in the price grid", async ({ page }) => {
  await asOwner(page, "/price-lists");
  await page.getByRole("link", { name: "Standard prices" }).click();
  await page.getByLabel(`${NAME} price per pack`).fill("abc");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText(/per pack: Use digits/)).toBeVisible();
  await page.getByLabel(`${NAME} price per pack`).fill("95.50");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("1 price saved")).toBeVisible();
});
