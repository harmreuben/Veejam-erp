/**
 * How the old system's data is brought across. Every choice the owner hasn't
 * confirmed yet is marked DEFAULT; change it here and re-run the import report.
 * See docs/DATA_MIGRATION.md for the questions behind each one.
 */

import type { CustomerType } from "@/generated/prisma/enums";

export type DecisionStatus = "DEFAULT" | "CONFIRMED";

export type CustomerGroup = {
  /** Name the customer gets in the new system. */
  name: string;
  type: CustomerType;
  /** Every spelling used in the old files (compared ignoring case and spaces). */
  oldNames: string[];
  status: DecisionStatus;
  note?: string;
};

/** Question 6: which old records are the same customer. 44 rows → 22 customers. */
export const CUSTOMER_GROUPS: CustomerGroup[] = [
  { name: "Abdi Wholesalers", type: "WHOLESALER", oldNames: ["Abdi Wholesalers"], status: "DEFAULT" },
  { name: "GiftMart", type: "WALK_IN", oldNames: ["GiftMart"], status: "DEFAULT" },
  { name: "Jogra Gikomba", type: "WHOLESALER", oldNames: ["Jogra Gikomba"], status: "DEFAULT" },
  { name: "Johnrace Stores", type: "WHOLESALER", oldNames: ["Johnrace stores"], status: "DEFAULT" },
  { name: "Joy Enterprise", type: "WALK_IN", oldNames: ["Joy Enterprise"], status: "DEFAULT" },
  {
    name: "Joy Shop Nazareth",
    type: "WALK_IN",
    oldNames: ["Joy Shop Nazareth"],
    status: "DEFAULT",
    note: "Kept separate from Joy Enterprise; no invoices. Merge if it's the same shop.",
  },
  {
    name: "Julio Makina",
    type: "WHOLESALER",
    oldNames: ["Julio", "Julio Makina", "Julio shop"],
    status: "DEFAULT",
    note: "Six old records (Julio, Julio Makina ×3, Julio shop ×2) treated as one customer.",
  },
  { name: "Junior", type: "WHOLESALER", oldNames: ["Junior"], status: "DEFAULT" },
  { name: "Kobia", type: "WHOLESALER", oldNames: ["Kobia"], status: "DEFAULT" },
  { name: "Lasty", type: "WHOLESALER", oldNames: ["Lasty"], status: "DEFAULT" },
  { name: "Marketing Shop", type: "WHOLESALER", oldNames: ["Marketing Shop"], status: "DEFAULT" },
  { name: "Martin Carni", type: "WHOLESALER", oldNames: ["Martin Carni"], status: "DEFAULT" },
  { name: "Masai Shop", type: "WHOLESALER", oldNames: ["Masai Shop"], status: "DEFAULT" },
  { name: "Mrefu", type: "WHOLESALER", oldNames: ["Mrefu"], status: "DEFAULT" },
  { name: "Muthaura", type: "WHOLESALER", oldNames: ["Muthaura"], status: "DEFAULT" },
  { name: "Mwana", type: "WHOLESALER", oldNames: ["Mwana"], status: "DEFAULT" },
  {
    name: "Sarah Karanja Road",
    type: "WALK_IN",
    oldNames: ["Sarah", "Sarah Karanja", "Sarah Karanja Road"],
    status: "DEFAULT",
    note: "Four old records treated as one walk-in customer.",
  },
  { name: "Shikoh Kawangware", type: "WHOLESALER", oldNames: ["Shikoh Kawangware"], status: "DEFAULT" },
  {
    name: "Soweto Supermarkets",
    type: "SUPERMARKET",
    oldNames: ["Soweto Supermakets"],
    status: "DEFAULT",
    note: "Spelling corrected. Its only invoice (June) is missing from the export.",
  },
  {
    name: "T.G Wholesale",
    type: "WHOLESALER",
    oldNames: ["T.G Wholesale", "Tg Wholesale"],
    status: "DEFAULT",
  },
  {
    name: "Toimound Makina Market",
    type: "WHOLESALER",
    oldNames: ["Toimoiund", "Toimound Makina market"],
    status: "DEFAULT",
  },
  {
    name: "Walk-in customer",
    type: "WALK_IN",
    oldNames: ["Walk-in Customer"],
    status: "DEFAULT",
    note: "General account for counter sales to people who aren't registered.",
  },
];

/** Question 7: test records from the old system that are not brought across. */
export const DEMO_CUSTOMERS: { names: string[]; status: DecisionStatus } = {
  names: [
    "Coast Distributors Ltd",
    "James Kiosk",
    "Mama Njeri Shop",
    "Nakumatt Supermarket",
    "Tuskys Supermarket",
    "Reuben Kariuki Maina",
  ],
  status: "DEFAULT",
};

/**
 * Question 2: invoices where the old system added 16% VAT on top of prices that
 * already included it. The line items add up to these totals.
 */
export const VAT_ON_TOP_CORRECTIONS: Record<string, { total: string; status: DecisionStatus }> = {
  "VJL-MUV7OFLC-KZ4": { total: "68540.00", status: "DEFAULT" },
  "VJL-MTY15V4S-A2A": { total: "4950.00", status: "DEFAULT" },
};

/**
 * Questions 3–4: the amount paid on each invoice is taken from the old invoice
 * list (its own paid/balance figures), not by adding up the payments file, which
 * has duplicates and payments on deleted invoices. Differences are listed in the report.
 */
export const AMOUNT_PAID_SOURCE: { source: "invoice-list"; status: DecisionStatus } = {
  source: "invoice-list",
  status: "DEFAULT",
};

/** Question 8: pack sizes. The old "pack_size" is pieces per packet; "units_per_case" is packets per carton. */
export const PACK_SIZE_SOURCE: { status: DecisionStatus } = { status: "DEFAULT" };

/** Prices: unit_price → Standard (retail) list per packet; wholesale_price → Wholesale list. */
export const WHOLESALE_PRICE_LIST = { code: "WHOLESALE", name: "Wholesale prices" };

export const OLD_VAT_RATE = "16";
