import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

// Phones only (see playwright.config.ts).
test("the phone menu slides over the page without moving it, and closes every expected way", async ({
  page,
}) => {
  // Measure positions without the page's entrance animation moving things.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await page.waitForURL(/\/dashboard$/);
  const heading = page.getByRole("heading", { level: 1, name: "Dashboard" });
  const before = (await heading.boundingBox())!.y;
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu).toBeHidden();

  // Opens over the page: the page underneath doesn't move.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Invoices" })).toBeVisible();
  expect((await heading.boundingBox())!.y).toBe(before);
  await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();

  // ✕ closes it.
  await page.getByRole("button", { name: "Close menu" }).click();
  await expect(menu).toBeHidden();

  // Escape closes it.
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // Tapping the dimmed page closes it.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(menu).toBeVisible();
  await page.mouse.click(page.viewportSize()!.width - 10, page.viewportSize()!.height / 2);
  await expect(menu).toBeHidden();

  // Choosing a page goes there and closes it.
  await page.getByRole("button", { name: "Open menu" }).click();
  await menu.getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
  await expect(menu).toBeHidden();

  // The top bar stays at the top while the page scrolls.
  await page.mouse.wheel(0, 2000);
  await expect(page.getByRole("button", { name: "Open menu" })).toBeInViewport();
});
