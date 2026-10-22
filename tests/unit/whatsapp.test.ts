import { describe, expect, it } from "vitest";

import { parseAmount, parseCommand } from "@/server/whatsapp/parse";
import { extractMessages, signBody, verifySignature } from "@/server/whatsapp/webhook";

describe("WhatsApp command parser", () => {
  it("reads look-up commands, case-insensitively and with messy spacing", () => {
    expect(parseCommand("  sales   today ")).toEqual({ kind: "sales", period: "today" });
    expect(parseCommand("SALES")).toEqual({ kind: "sales", period: "today" });
    expect(parseCommand("sales this month")).toEqual({ kind: "sales", period: "month" });
    expect(parseCommand("payments week")).toEqual({ kind: "payments", period: "week" });
    expect(parseCommand("stock Big G")).toEqual({ kind: "stock", product: "Big G" });
    expect(parseCommand("low stock")).toEqual({ kind: "lowStock" });
    expect(parseCommand("owed")).toEqual({ kind: "owed" });
    expect(parseCommand("balance cus-4")).toEqual({ kind: "balance", customer: "cus-4" });
    expect(parseCommand("invoice 12")).toEqual({ kind: "invoice", number: "INV-000012" });
    expect(parseCommand("INV INV-000345")).toEqual({ kind: "invoice", number: "INV-000345" });
    expect(parseCommand("hi")).toEqual({ kind: "help" });
    expect(parseCommand("")).toEqual({ kind: "help" });
  });

  it("explains how to use a command that is missing its details", () => {
    expect(parseCommand("stock")).toMatchObject({ kind: "usage", command: "STOCK" });
    expect(parseCommand("sales forever")).toMatchObject({ kind: "usage", command: "SALES" });
    expect(parseCommand("invoice abc")).toMatchObject({ kind: "usage", command: "INVOICE" });
    expect(parseCommand("what is this")).toEqual({ kind: "unknown", text: "what is this" });
  });

  it("reads PAY, including customer names with spaces and numbers", () => {
    expect(parseCommand("PAY Shop 24 Ruiru 3,000 cash")).toEqual({
      kind: "pay",
      customer: "Shop 24 Ruiru",
      amount: "3000.00",
      method: "CASH",
      reference: null,
    });
    expect(parseCommand("pay CUS-000004 KES 1500.5 mpesa sjk3h7qw2p")).toEqual({
      kind: "pay",
      customer: "CUS-000004",
      amount: "1500.50",
      method: "MPESA",
      reference: "SJK3H7QW2P",
    });
    expect(parseCommand("PAY Mama 200 bank FT123")).toMatchObject({
      method: "BANK_TRANSFER",
      reference: "FT123",
    });
  });

  it("refuses PAY without a valid amount, method, M-Pesa code or cheque number", () => {
    expect(parseCommand("PAY Mama 0 cash")).toMatchObject({ kind: "usage", command: "PAY" });
    expect(parseCommand("PAY Mama 10.555 cash")).toMatchObject({ kind: "usage" });
    expect(parseCommand("PAY Mama 100 bitcoin")).toMatchObject({
      kind: "usage",
      message: /isn't a payment method/,
    });
    expect(parseCommand("PAY Mama 100 mpesa")).toMatchObject({ kind: "usage", message: /M-Pesa code/ });
    expect(parseCommand("PAY Mama 100 mpesa ABC")).toMatchObject({ kind: "usage", message: /M-Pesa code/ });
    expect(parseCommand("PAY Mama 100 cheque")).toMatchObject({ kind: "usage", message: /cheque number/ });
    expect(parseCommand("PAY 100")).toMatchObject({ kind: "usage" });
  });

  it("reads SELL lines with units, and refuses lines it can't read", () => {
    expect(parseCommand("SELL Mama Pima: 2 ctn Big G, 5 pk Doublemint; 10 pcs PK Spearmint")).toEqual({
      kind: "sell",
      customer: "Mama Pima",
      lines: [
        { quantity: 2, unit: "CARTON", product: "Big G" },
        { quantity: 5, unit: "PACK", product: "Doublemint" },
        { quantity: 10, unit: "PIECE", product: "PK Spearmint" },
      ],
    });
    expect(parseCommand("SELL Mama Pima 2 ctn Big G")).toMatchObject({ kind: "usage", command: "SELL" });
    expect(parseCommand("SELL Mama: two ctn Big G")).toMatchObject({
      kind: "usage",
      message: /couldn't read/,
    });
    expect(parseCommand("SELL Mama: 2 boxes Big G")).toMatchObject({
      kind: "usage",
      message: /couldn't read/,
    });
    expect(parseCommand("SELL Mama: 0 ctn Big G")).toMatchObject({ kind: "usage", message: /at least 1/ });
  });

  it("reads confirmations only with a six-digit code", () => {
    expect(parseCommand("YES 482913")).toEqual({ kind: "confirm", code: "482913" });
    expect(parseCommand("yes 482 913")).toEqual({ kind: "confirm", code: "482913" });
    expect(parseCommand("yes")).toEqual({ kind: "confirm", code: null });
    expect(parseCommand("ok 12")).toEqual({ kind: "confirm", code: null });
    expect(parseCommand("no")).toEqual({ kind: "cancel" });
  });

  it("parses amounts exactly", () => {
    expect(parseAmount("1,234.5")).toBe("1234.50");
    expect(parseAmount("007")).toBe("7.00");
    expect(parseAmount("0.00")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
  });
});

describe("webhook signature and payload", () => {
  const secret = "app-secret-for-tests";
  const body = JSON.stringify({ entry: [] });

  it("accepts only an HMAC-SHA256 of the exact raw body", () => {
    const sig = signBody(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(body, sig.toUpperCase().replace("SHA256", "sha256"), secret)).toBe(true);
    expect(verifySignature(`${body} `, sig, secret)).toBe(false);
    expect(verifySignature(body, signBody(body, "other"), secret)).toBe(false);
    expect(verifySignature(body, null, secret)).toBe(false);
    expect(verifySignature(body, "sha256=abc", secret)).toBe(false);
    expect(verifySignature(body, sig, undefined)).toBe(false);
  });

  it("extracts text messages and skips statuses and malformed entries", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    id: "wamid.1",
                    from: "254711000001",
                    type: "text",
                    timestamp: "1761000000",
                    text: { body: "SALES" },
                  },
                  { id: "wamid.2", from: "254711000001", type: "image" },
                  { id: "wamid.3", from: "+254711", type: "text", text: { body: "x" } },
                  { from: "254711000001", type: "text", text: { body: "no id" } },
                ],
                statuses: [{ id: "wamid.0", status: "read" }],
              },
            },
          ],
        },
        { changes: "nope" },
      ],
    };
    expect(extractMessages(payload)).toEqual([
      { id: "wamid.1", from: "254711000001", text: "SALES", type: "text", timestamp: 1761000000 },
      { id: "wamid.2", from: "254711000001", text: null, type: "image", timestamp: null },
    ]);
    expect(extractMessages(null)).toEqual([]);
    expect(extractMessages({ entry: {} })).toEqual([]);
  });
});
