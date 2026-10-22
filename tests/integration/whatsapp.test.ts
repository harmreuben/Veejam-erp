import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { createCustomer } from "@/server/modules/customers/service";
import { customerBalance, recordPayment } from "@/server/modules/payments/service";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";
import { handleInbound, REFUSAL } from "@/server/whatsapp/inbound";
import { mockProvider } from "@/server/whatsapp/provider";
import { linkWhatsAppNumber } from "@/server/whatsapp/service";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, balance, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

const OWNER_NO = "254711000001";

async function setup() {
  const owner = await makeUser(db, "OWNER");
  await linkWhatsAppNumber(db, owner, { whatsappNumber: "0711000001" }, OWNER_NO);
  const product = await makeProduct(db, owner, {
    name: "Big G Original",
    prices: { PACK: "100", CARTON: "1900" },
  });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 4000);
  const customer = await createCustomer(db, owner, {
    name: `Mama Pima ${randomUUID().slice(0, 4)}`,
    type: "RETAIL_SHOP",
    creditLimit: "1000000",
  });
  return { owner, product, main, customer };
}

/** Send a message as if it came through the webhook (or the simulator). */
function send(
  text: string,
  opts: { from?: string; id?: string; simulated?: boolean; now?: Date; ownerNumber?: string } = {},
) {
  return handleInbound(
    db,
    {
      id: opts.id ?? `wamid.${randomUUID()}`,
      from: opts.from ?? OWNER_NO,
      text,
      type: "text",
      timestamp: null,
    },
    {
      provider: mockProvider,
      ownerNumber: "ownerNumber" in opts ? opts.ownerNumber : OWNER_NO,
      simulated: opts.simulated ?? false,
      now: opts.now,
    },
  );
}

const codeIn = (reply: string | null) => /YES (\d{6})/.exec(reply ?? "")?.[1] ?? "";

async function postedInvoice(s: Awaited<ReturnType<typeof setup>>, cartons = 2) {
  const { id } = await createDraft(db, s.owner, "INVOICE", {
    customerId: s.customer.id,
    warehouseId: s.main.id,
    issueDate: todayInNairobi(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons }],
  });
  return postInvoice(db, s.owner, id, { version: 1 });
}

describe("who may send commands", () => {
  it("a stranger gets one polite refusal a day and nothing else; every message is logged", async () => {
    await setup();
    const first = await send("SALES TODAY", { from: "254799999999" });
    expect(first).toEqual({ outcome: "refused", reply: REFUSAL });
    const second = await send("STOCK Big G", { from: "254799999999" });
    expect(second).toEqual({ outcome: "refused", reply: null });

    const log = await db.whatsAppMessage.findMany({
      where: { waNumber: "254799999999" },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((m) => [m.direction, m.status])).toEqual([
      ["IN", "REFUSED"],
      ["OUT", "SIMULATED"],
      ["IN", "REFUSED"],
    ]);
    expect(await db.auditLog.count({ where: { action: "WHATSAPP_SENDER_REFUSED" } })).toBe(1);
  });

  it("an admin's linked number is refused; the owner number must match the configured one", async () => {
    await setup();
    const admin = await makeUser(db, "ADMIN");
    await db.user.update({ where: { id: admin.id }, data: { whatsappNumber: "254722000002" } });
    expect((await send("HELP", { from: "254722000002", ownerNumber: "254722000002" })).outcome).toBe(
      "refused",
    );
    // Owner linked, but real messages from a number other than VEEJAM_OWNER_WHATSAPP_NUMBER are refused.
    expect((await send("HELP", { ownerNumber: "254700000000" })).outcome).toBe("refused");
    // Without a configured number only the in-app simulator works.
    expect((await send("HELP", { ownerNumber: undefined })).outcome).toBe("refused");
    expect((await send("HELP", { ownerNumber: undefined, simulated: true })).outcome).toBe("processed");
  });

  it("a deactivated owner is refused", async () => {
    const s = await setup();
    await db.user.update({ where: { id: s.owner.id }, data: { isActive: false, deactivatedAt: new Date() } });
    expect((await send("HELP")).outcome).toBe("refused");
  });

  it("only the configured number can be linked, and a number belongs to one user", async () => {
    const owner = await makeUser(db, "OWNER");
    await expect(
      linkWhatsAppNumber(db, owner, { whatsappNumber: "0722000000" }, OWNER_NO),
    ).rejects.toMatchObject({
      fieldErrors: { whatsappNumber: [expect.stringMatching(/VEEJAM_OWNER_WHATSAPP_NUMBER/)] },
    });
    await linkWhatsAppNumber(db, owner, { whatsappNumber: "+254 711 000 001" }, OWNER_NO);
    const other = await makeUser(db, "OWNER");
    await expect(linkWhatsAppNumber(db, other, { whatsappNumber: OWNER_NO }, OWNER_NO)).rejects.toThrow(
      /already linked/,
    );
    const admin = await makeUser(db, "ADMIN");
    await expect(linkWhatsAppNumber(db, admin, { whatsappNumber: OWNER_NO }, undefined)).rejects.toThrow();
  });

  it("the same message delivered twice is handled once", async () => {
    await setup();
    const id = `wamid.${randomUUID()}`;
    expect((await send("HELP", { id })).outcome).toBe("processed");
    expect((await send("HELP", { id })).outcome).toBe("duplicate");
    expect(await db.whatsAppMessage.count({ where: { direction: "OUT" } })).toBe(1);
  });

  it("more than 20 messages a minute are dropped, with one warning", async () => {
    await setup();
    const now = new Date();
    for (let i = 0; i < 20; i++) expect((await send("HELP", { now })).outcome).toBe("processed");
    const over = await send("HELP", { now });
    expect(over.outcome).toBe("limited");
    expect(over.reply).toMatch(/Too many messages/);
    expect((await send("HELP", { now })).reply).toBeNull();
  });
});

describe("read commands", () => {
  it("sales, stock, balance, invoice, owed and price answer from live data", async () => {
    const s = await setup();
    const { number } = await postedInvoice(s);

    const sales = (await send("sales today")).reply!;
    expect(sales).toContain("KES 3,800.00 on 1 invoice");

    expect((await send("STOCK big g")).reply).toMatch(/On hand: 3,600 pcs \(18 ctn\)/);
    expect((await send(`BALANCE ${s.customer.code}`)).reply).toContain("Owes: KES 3,800.00");
    expect((await send(`invoice ${Number(number.slice(4))}`)).reply).toContain(`*${number}*`);
    expect((await send("OWED")).reply).toContain(s.customer.code);
    expect((await send("PRICE Big G")).reply).toContain("carton: KES 1,900.00");
    expect((await send("hello there")).reply).toMatch(/commands/);
    expect((await send("frobnicate")).reply).toMatch(/didn't understand/);
  });

  it("ambiguous names list the choices instead of guessing", async () => {
    const s = await setup();
    await createCustomer(db, s.owner, { name: "Mama Pima Two", type: "RETAIL_SHOP" });
    expect((await send("BALANCE Mama Pima")).reply).toMatch(/matches 2 customers/);
  });
});

describe("PAY with confirmation", () => {
  it("nothing is recorded until YES with the right code; the code works once", async () => {
    const s = await setup();
    await postedInvoice(s);
    const ask = (await send(`PAY ${s.customer.code} 3000 MPESA sjk3h7qw2p`)).reply!;
    expect(ask).toContain("Record payment?");
    expect(ask).toContain("after this they owe KES 800.00");
    expect(await db.payment.count()).toBe(0);

    expect((await send("YES 000000")).reply).toMatch(/doesn't match/);
    const code = codeIn(ask);
    const done = (await send(`yes ${code}`)).reply!;
    expect(done).toMatch(/RCT-\d{6}: KES 3,000.00 .* recorded\. They now owe KES 800.00/);
    expect(await db.payment.count()).toBe(1);
    const payment = await db.payment.findFirstOrThrow();
    expect(payment.reference).toBe("SJK3H7QW2P");
    expect(payment.notes).toBe("Recorded on WhatsApp");

    expect((await send(`YES ${code}`)).reply).toMatch(/nothing waiting/);
    expect(await db.payment.count()).toBe(1);
    expect(await db.auditLog.count({ where: { action: "WHATSAPP_COMMAND_CONFIRMED" } })).toBe(1);
    // The same M-Pesa code is refused before asking.
    expect((await send(`PAY ${s.customer.code} 100 MPESA SJK3H7QW2P`)).reply).toMatch(/already recorded/);
  });

  it("refuses if the customer's balance changed before YES", async () => {
    const s = await setup();
    await postedInvoice(s);
    const code = codeIn((await send(`PAY ${s.customer.code} 1000 CASH`)).reply);
    await recordPayment(db, s.owner, {
      customerId: s.customer.id,
      receivedOn: todayInNairobi(),
      method: "CASH",
      amount: "500",
      idempotencyKey: randomUUID(),
    });
    expect((await send(`YES ${code}`)).reply).toMatch(/balance changed .* nothing was recorded/);
    expect(await db.payment.count()).toBe(1);
    expect((await db.whatsAppConfirmation.findFirstOrThrow()).status).toBe("FAILED");
  });

  it("expires after five minutes; three wrong codes cancel; NO cancels; a new request replaces the old", async () => {
    const s = await setup();
    await postedInvoice(s);
    const code = codeIn((await send(`PAY ${s.customer.code} 1000 CASH`)).reply);
    const later = new Date(Date.now() + 6 * 60_000);
    expect((await send(`YES ${code}`, { now: later })).reply).toMatch(/expired/);
    expect(await db.payment.count()).toBe(0);

    await send(`PAY ${s.customer.code} 1000 CASH`);
    for (let i = 0; i < 2; i++) await send("YES 111111");
    expect((await send("YES 111111")).reply).toMatch(/three times/);

    const first = codeIn((await send(`PAY ${s.customer.code} 1000 CASH`)).reply);
    await send(`PAY ${s.customer.code} 2000 CASH`);
    expect((await send(`YES ${first}`)).reply).toMatch(/doesn't match/);
    expect((await send("NO")).reply).toMatch(/Cancelled/);
    expect(await db.payment.count()).toBe(0);
    expect((await customerBalance(db, s.customer.id)).balance).toBe("3800.00");
  });
});

describe("SELL with confirmation", () => {
  it("saves a draft, then posts it on YES and takes the stock out", async () => {
    const s = await setup();
    const ask = (await send(`SELL ${s.customer.code}: 2 ctn Big G, 3 pk ${s.product.sku}`)).reply!;
    expect(ask).toContain("Post invoice for");
    expect(ask).toContain("Total KES 4,100.00");
    const draft = await db.salesDocument.findFirstOrThrow({ where: { kind: "INVOICE" } });
    expect(draft.status).toBe("DRAFT");
    expect(await balance(db, s.product.id, s.main.id)).toBe(4000);

    const done = (await send(`YES ${codeIn(ask)}`)).reply!;
    expect(done).toMatch(/INV-\d{6} posted/);
    expect(await balance(db, s.product.id, s.main.id)).toBe(4000 - 400 - 30);
  });

  it("NO cancels the draft; a draft edited in the ERP meanwhile is not posted", async () => {
    const s = await setup();
    await send(`SELL ${s.customer.code}: 1 ctn Big G`);
    await send("NO");
    expect((await db.salesDocument.findFirstOrThrow()).status).toBe("CANCELLED");

    const ask = (await send(`SELL ${s.customer.code}: 1 ctn Big G`)).reply!;
    const draft = await db.salesDocument.findFirstOrThrow({ where: { status: "DRAFT" } });
    await db.salesDocument.update({ where: { id: draft.id }, data: { version: { increment: 1 } } });
    expect((await send(`YES ${codeIn(ask)}`)).reply).toMatch(/Not done: .*changed by someone else/);
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
  });

  it("warns about missing stock up front and refuses to post", async () => {
    const s = await setup();
    const ask = (await send(`SELL ${s.customer.code}: 50 ctn Big G`)).reply!;
    expect(ask).toMatch(/Not enough stock/);
    expect((await send(`YES ${codeIn(ask)}`)).reply).toMatch(/Not done/);
    expect(await balance(db, s.product.id, s.main.id)).toBe(4000);
  });
});
