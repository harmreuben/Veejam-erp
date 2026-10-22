import { expect, test } from "@playwright/test";

import { formAlert, signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

test.describe.configure({ mode: "serial" });

test("every page carries a nonce-based Content-Security-Policy, and nothing on the dashboard breaks it", async ({
  page,
  request,
}) => {
  const res = await request.get("/login");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain("unsafe-eval");

  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Sales this month")).toBeVisible();
  await expect(
    page
      .getByRole("img", { name: /Daily sales and money received/ })
      .locator("svg")
      .first(),
  ).toBeVisible();
  // Client-side code works (it would be blocked without the nonce): open the table view.
  await page.getByText("Show as a table").click();
  await expect(page.getByRole("columnheader", { name: "Received" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("reports show figures and download as CSV", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/reports");
  await page
    .getByRole("navigation", { name: "Reports" })
    .getByRole("link", { name: "Sales", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Sales", exact: true })).toBeVisible();
  await page.getByLabel("Group by").selectOption("customer");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("row", { name: /E2E Sales Customer/ })).toBeVisible();

  const href = await page.getByRole("link", { name: "Download CSV" }).getAttribute("href");
  const csv = await page.request.get(href!);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("E2E Sales Customer");

  for (const [tab, heading] of [
    ["Money received", "Money received"],
    ["VAT", "VAT"],
    ["Profit and loss", "Profit and loss"],
    ["Stock value", "Stock value"],
  ] as const) {
    await page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: tab }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
  }
});

test("the audit log shows what happened, including WhatsApp confirmations", async ({ page }) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/audit");
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await page.getByLabel("Action").selectOption({ label: "Whatsapp command confirmed" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("row", { name: /PAY confirmed on WhatsApp: RCT-/ })).toBeVisible();
  await page.goto("/backups");
  await expect(page.getByRole("heading", { level: 1, name: "Backup & recovery" })).toBeVisible();
  await expect(page.getByText("Take one this week")).toBeVisible();
});

test("sales staff see neither reports nor the audit log", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/reports");
  await expect(page.getByRole("heading", { name: "You don't have access to reports" })).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByRole("heading", { name: "You don't have access to the audit log" })).toBeVisible();
  expect((await page.request.get("/reports/csv/sales")).status()).toBe(403);
});

test("repeated wrong passwords lock that email for a while", async ({ page }) => {
  for (let i = 0; i < 8; i++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill("guess@veejam.test");
    await page.getByLabel("Password").fill(`wrong-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(page)).toContainText("Email or password is incorrect.");
  }
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(formAlert(page)).toContainText(/Too many failed sign-in attempts/);
});
