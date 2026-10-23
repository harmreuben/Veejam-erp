import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// The real behaviour: no test header, so fresh loads go to the start page.
test.use({ extraHTTPHeaders: {} });

test("reloading or reopening the app lands on the dashboard; moving around inside it doesn't", async ({
  page,
}) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);

  // Inside the app, pages open normally.
  await page.getByRole("link", { name: "Invoices", exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();

  // Reload → dashboard.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  // Opening a saved address or a link from outside → dashboard too.
  await page.goto("/settings/users");
  await expect(page).toHaveURL(/\/dashboard$/);

  // Back and forward inside the app still work.
  await page.getByRole("link", { name: "Customers", exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("each person lands on their own start page; signed out goes to sign-in", async ({ browser }) => {
  const store = await (await browser.newContext({ extraHTTPHeaders: {} })).newPage();
  await signIn(store, E2E_USERS.storekeeper.email, E2E_USERS.storekeeper.password);
  await store.waitForURL((u) => !u.pathname.startsWith("/login"));
  await store.goto("/deliveries");
  await expect(store).toHaveURL(/\/inventory$/);

  const stranger = await (await browser.newContext({ extraHTTPHeaders: {} })).newPage();
  await stranger.goto("/invoices/anything");
  await expect(stranger).toHaveURL(/\/login$/);
});

test("PDFs still open in their own tab", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  // A fresh load of a file isn't sent anywhere.
  const res = await page.request.get("/payments", {
    headers: { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    maxRedirects: 0,
  });
  expect(res.status()).toBe(307);
  const pdf = await page.request.get("/documents/00000000-0000-4000-8000-000000000000/pdf", {
    headers: { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
    maxRedirects: 0,
  });
  expect(pdf.status()).not.toBe(307);
});
