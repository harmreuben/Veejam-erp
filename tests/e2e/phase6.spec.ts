import { createHmac } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./support/auth";
import { E2E_META_APP_SECRET, E2E_OWNER_WHATSAPP, E2E_USERS, E2E_VERIFY_TOKEN } from "./support/fixtures.mjs";

// Runs after phase5.spec.ts: "E2E Sales Customer" exists with a balance.
test.describe.configure({ mode: "serial" });

const thread = (page: Page) => page.getByRole("region", { name: "Conversation" }).getByRole("listitem");
const lastReply = (page: Page) => thread(page).last();

async function say(page: Page, text: string) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(thread(page).filter({ hasText: text }).last()).toBeVisible();
}

test("owner links their number and runs commands in the simulator, confirming a payment with the code", async ({
  page,
}) => {
  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/whatsapp");
  await expect(page.getByText("Link your WhatsApp number first.")).toBeVisible();
  await page.getByRole("link", { name: "Link your number" }).click();
  await page.getByLabel("Your WhatsApp number").fill("0722000000");
  await page.getByRole("button", { name: "Save number" }).click();
  await expect(page.getByText(/isn't the owner number/)).toBeVisible();
  await page.getByLabel("Your WhatsApp number").fill("0711 000 001");
  await page.getByRole("button", { name: "Save number" }).click();
  await expect(page.getByRole("definition").filter({ hasText: E2E_OWNER_WHATSAPP })).toBeVisible();

  await page.getByRole("link", { name: "Simulator" }).click();
  await expect(page.getByText(/Simulated\./)).toBeVisible();
  await page.getByRole("button", { name: "HELP" }).click();
  await expect(lastReply(page)).toContainText("VeeJam ERP commands");

  await say(page, "PAY E2E Sales Customer 500 cash");
  await expect(lastReply(page)).toContainText("Record payment?");
  const code = /YES (\d{6})/.exec((await lastReply(page).textContent()) ?? "")![1]!;
  await say(page, `YES ${code}`);
  await expect(lastReply(page)).toContainText(/RCT-\d{6}: KES 500\.00 from E2E Sales Customer recorded/);

  await page.goto("/payments");
  await expect(page.getByRole("row", { name: /E2E Sales Customer/ }).first()).toContainText("KES 500.00");
});

test("the webhook needs Meta's signature, handles a delivery once, and logs everything", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.get(
        `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${E2E_VERIFY_TOKEN}&hub.challenge=abc123`,
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc")
    ).status(),
  ).toBe(403);

  const body = JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messages: [
                { id: "wamid.e2e-1", from: E2E_OWNER_WHATSAPP, type: "text", text: { body: "SALES TODAY" } },
              ],
            },
          },
        ],
      },
    ],
  });
  const sign = (b: string) => `sha256=${createHmac("sha256", E2E_META_APP_SECRET).update(b).digest("hex")}`;
  const post = (b: string, sig: string) =>
    request.post("/api/whatsapp/webhook", {
      data: b,
      headers: { "content-type": "application/json", "x-hub-signature-256": sig },
    });

  expect((await post(body, "sha256=" + "0".repeat(64))).status()).toBe(401);
  expect((await post(body, sign(body))).status()).toBe(200);
  expect((await post(body, sign(body))).status()).toBe(200); // Meta retry: ignored

  await signIn(page, E2E_USERS.owner.email, E2E_USERS.owner.password, "/whatsapp/log");
  await expect(page.getByRole("heading", { level: 1, name: "Message log" })).toBeVisible();
  const ins = page.getByRole("row").filter({ hasText: "SALES TODAY" }).filter({ hasNotText: "simulated" });
  await expect(ins).toHaveCount(1);
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: /Sales today/ })
      .first(),
  ).toBeVisible();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: /Confirmed/ })
      .first(),
  ).toContainText(/RCT-/);
});

test("sales staff can't use WhatsApp commands", async ({ page }) => {
  await signIn(page, E2E_USERS.sales.email, E2E_USERS.sales.password, "/whatsapp");
  await expect(
    page.getByRole("heading", { name: "You don't have access to WhatsApp commands" }),
  ).toBeVisible();
});
