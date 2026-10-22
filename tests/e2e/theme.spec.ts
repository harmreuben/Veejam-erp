import { expect, test } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_USERS } from "./support/fixtures.mjs";

const background = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("the theme switch applies at once and is remembered on the next page", async ({ page, isMobile }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/dashboard");
  await page.waitForURL(/\/dashboard$/);
  if (isMobile) {
    // The menu button sits on the left, before the company name.
    const bar = page.getByRole("banner").filter({ visible: true }).first();
    const [button, name] = await Promise.all([
      bar.getByRole("button", { name: "Open menu" }).boundingBox(),
      bar.getByText("VeeJam Limited").boundingBox(),
    ]);
    expect(button!.x).toBeLessThan(name!.x);
    await bar.getByRole("button", { name: "Open menu" }).click();
  }
  const themes = page.getByRole("group", { name: "Colour theme" }).filter({ visible: true });
  const light = await background(page);

  await themes.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background(page)).not.toBe(light);

  // Drawn dark by the server on the next page, with no flash.
  const res = await page.request.get("/invoices");
  expect(await res.text()).toMatch(/<html[^>]*data-theme="dark"/);
  await page.goto("/invoices");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // System follows the device: this device is light.
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("group", { name: "Colour theme" })
    .filter({ visible: true })
    .getByRole("button", { name: "System" })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  expect(await background(page)).toBe(light);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background(page)).not.toBe(light);
});
