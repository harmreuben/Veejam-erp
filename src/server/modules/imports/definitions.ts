import { z } from "zod";

import { CustomerType } from "@/generated/prisma/enums";
import type { ImportKind } from "@/generated/prisma/enums";
import { productFieldsSchema, unitPricesSchema } from "@/server/modules/catalogue/schemas";
import {
  CUSTOMER_TYPE_LABELS,
  customerFieldsSchema,
  supplierFieldsSchema,
} from "@/server/modules/customers/schemas";

export type ColumnDef = { name: string; required?: boolean; help: string };

/** The columns each import accepts. The downloadable templates are built from these. */
export const IMPORT_COLUMNS: Record<ImportKind, ColumnDef[]> = {
  PRODUCTS: [
    {
      name: "sku",
      required: true,
      help: "Product code, e.g. WRG-001. An existing SKU updates that product.",
    },
    { name: "name", required: true, help: "Product name as it should appear on invoices" },
    { name: "brand", required: true, help: "e.g. Wrigley's" },
    { name: "category", required: true, help: "e.g. Chewing gum" },
    { name: "units_per_pack", required: true, help: "Pieces in one pack (whole number, at least 1)" },
    { name: "packs_per_carton", required: true, help: "Packs in one carton (whole number, at least 1)" },
    { name: "barcode", help: "6–20 digits; optional" },
    { name: "cost_price", help: "Cost of one piece, excluding VAT; blank if not known" },
    { name: "reorder_level", help: "Warn when total stock falls to this many pieces; blank = 0" },
    { name: "tax_category", help: "STANDARD, ZERO_RATED or EXEMPT; blank = STANDARD" },
    { name: "status", help: "ACTIVE or INACTIVE; blank = ACTIVE" },
    { name: "price_piece", help: "Price of one piece on the default price list; blank leaves it unchanged" },
    { name: "price_pack", help: "Price of one pack on the default price list" },
    { name: "price_carton", help: "Price of one carton on the default price list" },
    { name: "notes", help: "Optional" },
  ],
  CUSTOMERS: [
    { name: "code", help: "Blank for a new customer. An existing code (CUS-000001) updates that customer." },
    { name: "name", required: true, help: "Business name" },
    { name: "type", help: `One of: ${Object.values(CUSTOMER_TYPE_LABELS).join(", ")}; blank = Retail shop` },
    { name: "contact_person", help: "Optional" },
    { name: "phone", help: "Kenyan number, e.g. 0712345678; placeholders like 0700 are rejected" },
    { name: "email", help: "Optional" },
    { name: "kra_pin", help: "e.g. P051234567X; optional" },
    { name: "physical_address", help: "Optional" },
    { name: "town", help: "Optional" },
    { name: "credit_limit", help: "KES; blank or 0 = cash only" },
    { name: "payment_terms_days", help: "Days to pay; blank = 0" },
    { name: "price_list", help: "Price list code, e.g. STANDARD; blank = the default list" },
    { name: "status", help: "ACTIVE or INACTIVE; blank = ACTIVE" },
    { name: "notes", help: "Optional" },
    { name: "allow_duplicate_name", help: "YES only if a same-name customer really is a different business" },
  ],
  SUPPLIERS: [
    { name: "code", help: "Blank for a new supplier. An existing code (SUP-000001) updates that supplier." },
    { name: "name", required: true, help: "Business name" },
    { name: "contact_person", help: "Optional" },
    { name: "phone", help: "Kenyan number" },
    { name: "email", help: "Optional" },
    { name: "kra_pin", help: "Optional" },
    { name: "physical_address", help: "Optional" },
    { name: "payment_terms_days", help: "Days VeeJam has to pay; blank = 0" },
    { name: "status", help: "ACTIVE or INACTIVE; blank = ACTIVE" },
    { name: "notes", help: "Optional" },
  ],
};

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  PRODUCTS: "Products and prices",
  CUSTOMERS: "Customers",
  SUPPLIERS: "Suppliers",
};

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** "Retail shop", "retail_shop", "RETAIL SHOP" → RETAIL_SHOP. */
function customerType(raw: string): string {
  const v = raw.trim();
  if (!v) return "RETAIL_SHOP";
  const key = v.toUpperCase().replace(/[\s-]+/g, "_");
  if ((Object.values(CustomerType) as string[]).includes(key)) return key;
  const byLabel = Object.entries(CUSTOMER_TYPE_LABELS).find(
    ([, label]) => label.toLowerCase() === v.toLowerCase(),
  );
  return byLabel ? byLabel[0] : v;
}

const upperOr = (raw: string | undefined, fallback: string) =>
  raw?.trim() ? raw.trim().toUpperCase() : fallback;
const blankAs = (raw: string | undefined, fallback: string) => (raw?.trim() ? raw.trim() : fallback);

/** Map CSV columns to the same fields the forms use, so imports follow the same rules. */
export function productRowInput(r: Record<string, string>) {
  return {
    sku: r.sku ?? "",
    name: r.name ?? "",
    brand: r.brand ?? "",
    category: r.category ?? "",
    unitsPerPack: blankAs(r.units_per_pack, ""),
    packsPerCarton: blankAs(r.packs_per_carton, ""),
    barcode: r.barcode ?? "",
    costPrice: r.cost_price ?? "",
    reorderLevel: blankAs(r.reorder_level, "0"),
    taxCategory: upperOr(r.tax_category, "STANDARD"),
    status: upperOr(r.status, "ACTIVE"),
    notes: r.notes ?? "",
    prices: { PIECE: r.price_piece ?? "", PACK: r.price_pack ?? "", CARTON: r.price_carton ?? "" },
  };
}

export const productRowSchema = productFieldsSchema.extend({ prices: unitPricesSchema });

export function customerRowInput(r: Record<string, string>) {
  return {
    name: r.name ?? "",
    type: customerType(r.type ?? ""),
    contactPerson: r.contact_person ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    kraPin: r.kra_pin ?? "",
    physicalAddress: r.physical_address ?? "",
    town: r.town ?? "",
    creditLimit: r.credit_limit ?? "",
    paymentTermsDays: blankAs(r.payment_terms_days, "0"),
    priceListId: null,
    status: upperOr(r.status, "ACTIVE"),
    notes: r.notes ?? "",
  };
}
export const customerRowSchema = customerFieldsSchema;

export function supplierRowInput(r: Record<string, string>) {
  return {
    name: r.name ?? "",
    contactPerson: r.contact_person ?? "",
    phone: r.phone ?? "",
    email: r.email ?? "",
    kraPin: r.kra_pin ?? "",
    physicalAddress: r.physical_address ?? "",
    paymentTermsDays: blankAs(r.payment_terms_days, "0"),
    status: upperOr(r.status, "ACTIVE"),
    notes: r.notes ?? "",
  };
}
export const supplierRowSchema = supplierFieldsSchema;

/** Zod issues → "column: message" strings, naming the CSV column a person sees. */
const FIELD_TO_COLUMN: Record<string, string> = {
  unitsPerPack: "units_per_pack",
  packsPerCarton: "packs_per_carton",
  costPrice: "cost_price",
  reorderLevel: "reorder_level",
  taxCategory: "tax_category",
  contactPerson: "contact_person",
  kraPin: "kra_pin",
  physicalAddress: "physical_address",
  creditLimit: "credit_limit",
  paymentTermsDays: "payment_terms_days",
  "prices.PIECE": "price_piece",
  "prices.PACK": "price_pack",
  "prices.CARTON": "price_carton",
};

export function issuesToMessages(error: z.ZodError): string[] {
  return error.issues.map((i) => {
    const field = i.path.join(".");
    const column = FIELD_TO_COLUMN[field] ?? field;
    const message =
      i.code === "invalid_value" && field === "type"
        ? `use one of: ${Object.values(CUSTOMER_TYPE_LABELS).join(", ")}`
        : i.code === "invalid_value"
          ? `"${String((i as { input?: unknown }).input ?? "")}" isn't allowed`
          : i.message;
    return `${column}: ${message}`;
  });
}

/** Normalise a header: "Units per pack " → "units_per_pack". */
export function normaliseHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function templateCsv(kind: ImportKind): string {
  return `${IMPORT_COLUMNS[kind].map((c) => c.name).join(",")}\r\n`;
}
