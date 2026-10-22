import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page, email: string, password: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signOut(page: Page, isMobile = false) {
  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** The form's own error message (Next.js also renders a hidden route announcer with role="alert"). */
export function formAlert(page: Page) {
  return page.locator("form").getByRole("alert");
}
