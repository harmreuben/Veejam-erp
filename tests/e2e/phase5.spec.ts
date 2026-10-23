import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Runs after phase4.spec.ts, which leaves "E2E Sales Customer" with a posted
// invoice for 2 cartons (KES 4,000.00) and 1 carton in stock.
const CUSTOMER = "E2E Sales Customer";

test.describe.configure({ mode: "serial" });

async function openPostedInvoice(page: Page) {
  // Let a sign-in that's still in progress finish first.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.goto("/invoices?status=POSTED");
  await page
    .getByRole("row", { name: new RegExp(CUSTOMER) })
    .getByRole("link", { name: /INV-\d{6}/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { level: 1, name: /INV-\d{6}/ })).toBeVisible();
}

test("sales records an M-Pesa payment from the invoice; the code can't be reused", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/invoices?status=POSTED");
  await openPostedInvoice(page);
  await page.getByRole("link", { name: "Record payment" }).click();
  await expect(page.getByLabel("Amount received (KES)")).toHaveValue("4000.00");
  await page.getByLabel("How they paid").selectOption("MPESA");
  await page.getByLabel("M-Pesa code").fill("sjk3h7qw2p");
  await page.getByLabel("Amount received (KES)").fill("3000");
  await expect(page.getByText(/Applied to invoices/)).toContainText("KES 3,000.00");
  await page.getByRole("button", { name: "Record payment" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /RCT-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("recorded");
  const receipt = await page.request.get(
    (await page.getByRole("link", { name: "Receipt", exact: true }).getAttribute("href"))!,
  );
  expect(receipt.headers()["content-type"]).toBe("application/pdf");
  // Sales can't reverse.
  await expect(page.getByRole("button", { name: "Reverse…" })).toHaveCount(0);

  await openPostedInvoice(page);
  await expect(page.getByText("Balance due")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("KES 1,000.00");

  // Same M-Pesa code again is refused on the field.
  await page.goto("/payments/new");
  const select = page.getByLabel("Customer", { exact: true });
  await select.selectOption((await select.locator("option", { hasText: CUSTOMER }).getAttribute("value"))!);
  await page.getByLabel("Amount received (KES)").fill("500");
  await page.getByLabel("How they paid").selectOption("MPESA");
  await page.getByLabel("M-Pesa code").fill("SJK3H7QW2P");
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/SJK3H7QW2P was already recorded on RCT-/)).toBeVisible();
});

test("owner issues a credit note for a returned carton; it clears the balance and leaves credit", async ({
  page,
}) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/invoices?status=POSTED");
  await openPostedInvoice(page);
  await page.getByRole("link", { name: "Credit note…" }).click();
  await page
    .getByLabel(/quantity to credit/)
    .first()
    .fill("1");
  const summary = page.getByText(/Credit note total/);
  await expect(summary).toContainText("KES 2,000.00");
  await expect(summary).toContainText("KES 1,000.00 becomes credit on the account");
  await page.getByLabel(/Reason/).fill("One carton returned unopened");
  await page.getByText("put them back into stock").click();
  await page.getByRole("button", { name: "Issue credit note" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /CN-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "issued" })).toContainText("back in stock");
  const first = (await page.getByRole("heading", { level: 1 }).textContent())!.match(/CN-\d{6}/)![0];

  // The owner corrects it: same carton and stock choice, a better reason.
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel(/quantity to credit/).first()).toHaveValue("1");
  await expect(page.getByRole("checkbox", { name: /put them back into stock/ })).toBeChecked();
  await page.getByLabel(/Reason/).fill("One carton returned unopened by the shop");
  await page.getByLabel(/Why is it being changed/).fill("Reason needed more detail");
  await page.getByRole("button", { name: "Save corrected credit note" }).click();
  await expect(page.getByRole("status").filter({ hasText: "in place of" })).toContainText(first);
  await expect(page.getByRole("heading", { level: 1, name: /CN-\d{6}/ })).not.toContainText(first);
  await page.getByRole("link", { name: first }).click();
  await expect(page.getByText(/Replaced by/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  await page.goto("/customers?q=E2E%20Sales");
  await page.getByRole("link", { name: CUSTOMER }).click();
  await expect(page.getByText("Credit not yet applied").locator("..")).toContainText("KES 1,000.00");
  await page.getByRole("link", { name: "Statement" }).click();
  await expect(page.getByText(/In credit by/)).toContainText("KES 1,000.00");
});

test("owner starts the books; the trial balance balances; a manual journal posts", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/accounting");
  await expect(page.getByRole("heading", { level: 1, name: "Trial balance" })).toBeVisible();
  const start = page.getByRole("button", { name: "Start the books" });
  if (await start.count()) {
    await start.click();
    await expect(start).toHaveCount(0);
  }
  await expect(page.getByRole("row", { name: /Totals/ })).not.toContainText("do not balance");

  await page.getByRole("link", { name: "New journal entry" }).click();
  await page.getByLabel("Description").fill("October rent");
  await page.getByLabel("Line 1 account").selectOption({ label: "6000 Rent" });
  await page.getByLabel("Line 1 debit").fill("25000");
  await page.getByLabel("Line 2 account").selectOption({ label: "1020 Bank" });
  await page.getByLabel("Line 2 credit").fill("24000");
  await expect(page.getByText(/Difference KES 1,000.00/)).toBeVisible();
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByText(/must be equal/)).toBeVisible();
  await page.getByLabel("Line 2 credit").fill("25000");
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /JE-\d{6}/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /6000 Rent/ })).toContainText("KES 25,000.00");
});

test("sales can't see the accounts", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/accounting");
  await expect(page.getByRole("heading", { name: "You don't have access to the accounts" })).toBeVisible();
});
