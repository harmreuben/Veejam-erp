/**
 * WhatsApp command parser. Pure: text in, a command out, no database access,
 * so every accepted and rejected form is covered by unit tests.
 *
 * Commands are case-insensitive and forgiving about spaces. Anything that
 * changes data (PAY, SELL) only produces a draft; nothing is saved until the
 * owner replies YES with the code.
 */

export type Period = "today" | "yesterday" | "week" | "month";
export type SellUnitWord = "PIECE" | "PACK" | "CARTON";
export type PayMethod = "CASH" | "MPESA" | "BANK_TRANSFER" | "CHEQUE";

export type SellLine = { quantity: number; unit: SellUnitWord; product: string };

export type Command =
  | { kind: "help" }
  | { kind: "stock"; product: string }
  | { kind: "price"; product: string }
  | { kind: "products"; query: string }
  | { kind: "customers"; query: string }
  | { kind: "balance"; customer: string }
  | { kind: "statement"; customer: string }
  | { kind: "sales"; period: Period }
  | { kind: "payments"; period: Period }
  | { kind: "lowStock" }
  | { kind: "owed" }
  | { kind: "invoice"; number: string }
  | { kind: "pay"; customer: string; amount: string; method: PayMethod; reference: string | null }
  | { kind: "sell"; customer: string; lines: SellLine[] }
  | { kind: "confirm"; code: string | null }
  | { kind: "cancel" }
  | { kind: "usage"; command: string; message: string }
  | { kind: "unknown"; text: string };

/** Name used in the message log for a parsed command. */
export function commandName(c: Command): string | null {
  switch (c.kind) {
    case "unknown":
      return null;
    case "usage":
      return c.command;
    case "lowStock":
      return "LOW STOCK";
    default:
      return c.kind.toUpperCase();
  }
}

export const USAGE = {
  STOCK: "STOCK <product>, e.g. STOCK Big G",
  PRICE: "PRICE <product>, e.g. PRICE Doublemint",
  PRODUCT: "PRODUCT <search>, e.g. PRODUCT mint",
  CUSTOMER: "CUSTOMER <search>, e.g. CUSTOMER Mama Pima",
  BALANCE: "BALANCE <customer>, e.g. BALANCE CUS-000004",
  STATEMENT: "STATEMENT <customer>",
  INVOICE: "INVOICE <number>, e.g. INVOICE INV-000012",
  PAY: "PAY <customer> <amount> <CASH|MPESA|BANK|CHEQUE> [code], e.g. PAY CUS-000004 3000 MPESA SJK3H7QW2P",
  SELL: "SELL <customer>: <qty> <ctn|pk|pc> <product>, … e.g. SELL Mama Pima: 2 ctn Big G, 5 pk Doublemint",
  YES: "YES <code>, e.g. YES 482913",
} as const;

const PERIODS: Record<string, Period> = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  WEEK: "week",
  "THIS WEEK": "week",
  MONTH: "month",
  "THIS MONTH": "month",
};

const UNITS: Record<string, SellUnitWord> = {
  PC: "PIECE",
  PCS: "PIECE",
  PIECE: "PIECE",
  PIECES: "PIECE",
  PK: "PACK",
  PKT: "PACK",
  PKTS: "PACK",
  PACK: "PACK",
  PACKS: "PACK",
  PACKET: "PACK",
  PACKETS: "PACK",
  CTN: "CARTON",
  CTNS: "CARTON",
  CARTON: "CARTON",
  CARTONS: "CARTON",
};

const METHODS: Record<string, PayMethod> = {
  CASH: "CASH",
  MPESA: "MPESA",
  "M-PESA": "MPESA",
  BANK: "BANK_TRANSFER",
  TRANSFER: "BANK_TRANSFER",
  EFT: "BANK_TRANSFER",
  CHEQUE: "CHEQUE",
  CHECK: "CHEQUE",
};

const MAX_TEXT = 1000;

function usage(command: keyof typeof USAGE, problem?: string): Command {
  return {
    kind: "usage",
    command,
    message: `${problem ? `${problem}\n` : ""}Send: ${USAGE[command]}`,
  };
}

function period(rest: string): Period | null {
  if (!rest) return "today";
  return PERIODS[rest.toUpperCase()] ?? null;
}

/** "3,000" → "3000.00"; null if not a positive amount with at most 2 decimals. */
export function parseAmount(raw: string): string | null {
  const t = raw.replace(/,/g, "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const value = `${BigInt(whole!).toString()}.${frac.padEnd(2, "0")}`;
  return /^0\.00$/.test(value) ? null : value;
}

function parseSellLines(text: string): SellLine[] | string {
  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "Add at least one product.";
  if (parts.length > 20) return "At most 20 products in one SELL message; use the web app for bigger orders.";
  const lines: SellLine[] = [];
  for (const part of parts) {
    const m = /^(\d{1,6})\s*([a-z-]+)\s+(.+)$/i.exec(part);
    const unit = m ? UNITS[m[2]!.toUpperCase()] : undefined;
    if (!m || !unit) {
      return `I couldn't read "${part}". Write each product as <quantity> <ctn|pk|pc> <product>, e.g. 2 ctn Big G.`;
    }
    const quantity = Number(m[1]);
    if (quantity < 1) return `"${part}": the quantity must be at least 1.`;
    lines.push({ quantity, unit, product: m[3]!.trim() });
  }
  return lines;
}

export function parseCommand(input: string): Command {
  const text = input.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
  if (!text) return { kind: "help" };
  const upper = text.toUpperCase();
  const [first = "", ...restWords] = text.split(" ");
  const verb = first.toUpperCase().replace(/[^A-Z-]/g, "");
  const rest = restWords.join(" ").trim();

  if (["HELP", "MENU", "HI", "HELLO", "START", "?"].includes(verb || text)) return { kind: "help" };

  if (/^(LOW STOCK|LOW|LOWSTOCK)$/.test(upper)) return { kind: "lowStock" };
  if (/^(OWED|DEBTORS|WHO OWES|BALANCES)$/.test(upper)) return { kind: "owed" };

  switch (verb) {
    case "STOCK":
      return rest ? { kind: "stock", product: rest } : usage("STOCK");
    case "PRICE":
    case "PRICES":
      return rest ? { kind: "price", product: rest } : usage("PRICE");
    case "PRODUCT":
    case "PRODUCTS":
      return rest ? { kind: "products", query: rest } : usage("PRODUCT");
    case "CUSTOMER":
    case "CUSTOMERS":
      return rest ? { kind: "customers", query: rest } : usage("CUSTOMER");
    case "BALANCE":
    case "BAL":
      return rest ? { kind: "balance", customer: rest } : usage("BALANCE");
    case "STATEMENT":
      return rest ? { kind: "statement", customer: rest } : usage("STATEMENT");
    case "SALES": {
      const p = period(rest);
      return p
        ? { kind: "sales", period: p }
        : {
            kind: "usage",
            command: "SALES",
            message: "Send: SALES TODAY, SALES YESTERDAY, SALES WEEK or SALES MONTH",
          };
    }
    case "PAYMENTS":
    case "COLLECTIONS": {
      const p = period(rest);
      return p
        ? { kind: "payments", period: p }
        : {
            kind: "usage",
            command: "PAYMENTS",
            message: "Send: PAYMENTS TODAY, PAYMENTS WEEK or PAYMENTS MONTH",
          };
    }
    case "INVOICE":
    case "INV": {
      const m = /^(?:INV-?)?0*(\d{1,9})$/i.exec(rest.replace(/\s/g, ""));
      return m ? { kind: "invoice", number: `INV-${m[1]!.padStart(6, "0")}` } : usage("INVOICE");
    }
    case "PAY":
    case "PAID": {
      const m = /^(.+?)\s+(?:KES\s*|KSH\s*)?([\d,]+(?:\.\d{1,2})?)\s+([A-Z-]+)(?:\s+(\S+))?$/i.exec(rest);
      if (!m) return usage("PAY");
      const method = METHODS[m[3]!.toUpperCase()];
      if (!method) return usage("PAY", `"${m[3]}" isn't a payment method I know.`);
      const amount = parseAmount(m[2]!);
      if (!amount) return usage("PAY", `"${m[2]}" isn't an amount I can use.`);
      const reference = m[4] ? m[4].toUpperCase() : null;
      if (method === "MPESA" && !/^[A-Z0-9]{10}$/.test(reference ?? "")) {
        return usage("PAY", "Add the 10-character M-Pesa code from the confirmation message.");
      }
      if (method === "CHEQUE" && !reference) return usage("PAY", "Add the cheque number.");
      return { kind: "pay", customer: m[1]!.trim(), amount, method, reference };
    }
    case "SELL":
    case "SALE": {
      const colon = rest.indexOf(":");
      if (colon < 1) return usage("SELL");
      const customer = rest.slice(0, colon).trim();
      const lines = parseSellLines(rest.slice(colon + 1));
      if (typeof lines === "string") return usage("SELL", lines);
      return { kind: "sell", customer, lines };
    }
    case "YES":
    case "Y":
    case "CONFIRM":
    case "OK": {
      const code = rest.replace(/\s/g, "");
      return { kind: "confirm", code: /^\d{6}$/.test(code) ? code : null };
    }
    case "NO":
    case "N":
    case "CANCEL":
    case "STOP":
      return { kind: "cancel" };
  }
  return { kind: "unknown", text };
}

export const HELP_TEXT = [
  "*VeeJam ERP commands*",
  "",
  "*Look things up*",
  "SALES TODAY | YESTERDAY | WEEK | MONTH",
  "PAYMENTS TODAY | WEEK | MONTH",
  "STOCK <product>",
  "LOW STOCK",
  "PRICE <product>",
  "PRODUCT <search>",
  "CUSTOMER <search>",
  "BALANCE <customer>",
  "STATEMENT <customer>",
  "OWED (who owes the most)",
  "INVOICE <number>",
  "",
  "*Make changes* (you'll be asked to confirm)",
  USAGE.PAY,
  USAGE.SELL,
  "",
  "Reply YES <code> to confirm, NO to cancel.",
].join("\n");
