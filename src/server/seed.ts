import "server-only";

import { DEFAULT_COMPANY_PROFILE, DEFAULT_DOCUMENT_DETAILS } from "@/config/company";
import type { DocumentType, TaxCategory } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
import { DEFAULT_ACCOUNTS } from "@/server/modules/accounting/journal";
import type { Db } from "@/server/db/client";

/** Document number prefixes, e.g. INV-000001. Editable later; never reset by the seed. */
export const DEFAULT_SEQUENCES: Record<DocumentType, string> = {
  QUOTATION: "QUO-",
  SALES_ORDER: "SO-",
  INVOICE: "INV-",
  RECEIPT: "RCT-",
  CREDIT_NOTE: "CN-",
  DELIVERY_NOTE: "DN-",
  PURCHASE_ORDER: "PO-",
  GOODS_RECEIPT: "GRN-",
  STOCK_ADJUSTMENT: "ADJ-",
  JOURNAL_ENTRY: "JE-",
  CUSTOMER: "CUS-",
  SUPPLIER: "SUP-",
  STOCK_TRANSFER: "TRF-",
  STOCK_COUNT: "CNT-",
  SUPPLIER_BILL: "BILL-",
  SUPPLIER_PAYMENT: "SPAY-",
  STOCK_REVALUATION: "REV-",
};

/** Structural starting points (renameable). Not business data: no products, customers or prices. */
export const DEFAULT_WAREHOUSE = { code: "MAIN", name: "Main store" };
export const DEFAULT_PRICE_LIST = { code: "STANDARD", name: "Standard prices", pricesIncludeTax: true };
/** Kenyan VAT as at October 2026. Editable on Settings → Tax rates; confirm with the accountant. */
export const DEFAULT_TAX_RATES: Record<TaxCategory, { name: string; rate: string }> = {
  STANDARD: { name: "VAT 16%", rate: "16" },
  ZERO_RATED: { name: "Zero-rated", rate: "0" },
  EXEMPT: { name: "Exempt", rate: "0" },
};

export type SeedReport = {
  companySettings: "created" | "kept";
  sequencesCreated: DocumentType[];
  warehouse: "created" | "kept";
  defaultPriceList: "created" | "kept";
  taxRatesCreated: TaxCategory[];
  documentDetailsFilled: string[];
  accountsCreated: number;
};

/**
 * Initial data every installation needs. Safe to run any number of times:
 * it only creates what is missing and never overwrites edits or resets numbering.
 * No products, customers or other business data are seeded.
 */
export async function applySeed(db: Db): Promise<SeedReport> {
  return db.$transaction(async (tx) => {
    const existing = await tx.companySettings.findUnique({ where: { id: 1 } });
    if (!existing) {
      await tx.companySettings.create({ data: { id: 1, ...DEFAULT_COMPANY_PROFILE } });
    }

    const have = new Set(
      (await tx.documentSequence.findMany({ select: { documentType: true } })).map((s) => s.documentType),
    );
    const missing = (Object.keys(DEFAULT_SEQUENCES) as DocumentType[]).filter((t) => !have.has(t));
    if (missing.length) {
      await tx.documentSequence.createMany({
        data: missing.map((documentType) => ({ documentType, prefix: DEFAULT_SEQUENCES[documentType] })),
      });
    }

    // A first warehouse, so stock can be recorded straight away.
    const warehouseCount = await tx.warehouse.count();
    if (warehouseCount === 0) await tx.warehouse.create({ data: DEFAULT_WAREHOUSE });

    // A default price list, linked from company settings.
    const settings = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    let priceListCreated = false;
    if (!settings.defaultPriceListId) {
      const list =
        (await tx.priceList.findUnique({ where: { code: DEFAULT_PRICE_LIST.code } })) ??
        (await tx.priceList.create({ data: DEFAULT_PRICE_LIST }));
      priceListCreated = true;
      await tx.companySettings.update({ where: { id: 1 }, data: { defaultPriceListId: list.id } });
    }

    // Tax rates: create missing categories, never overwrite an edited rate.
    const haveRates = new Set(
      (await tx.taxRate.findMany({ select: { category: true } })).map((r) => r.category),
    );
    const missingRates = (Object.keys(DEFAULT_TAX_RATES) as TaxCategory[]).filter((c) => !haveRates.has(c));
    if (missingRates.length) {
      await tx.taxRate.createMany({
        data: missingRates.map((category) => ({ category, ...DEFAULT_TAX_RATES[category] })),
      });
    }

    // Invoice details (from the old system's invoice): only where still empty.
    const current = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    const fill: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(DEFAULT_DOCUMENT_DETAILS)) {
      if (current[key as keyof typeof DEFAULT_DOCUMENT_DETAILS] == null) fill[key] = value;
    }
    // First time the document details are filled in: match the old invoice (VAT registered, due in 30 days).
    if ("tagline" in fill) {
      if (!current.vatRegistered) fill.vatRegistered = true;
      if (current.defaultPaymentTermsDays === 0) fill.defaultPaymentTermsDays = 30 as never;
    }
    if (Object.keys(fill).length) await tx.companySettings.update({ where: { id: 1 }, data: fill });
    const documentDetailsFilled = Object.keys(fill);

    // Chart of accounts: add the system accounts (matched by key) and the starter accounts (by code) that are missing.
    const haveAccounts = await tx.account.findMany({ select: { code: true, systemKey: true } });
    const usedCodes = new Set(haveAccounts.map((h) => h.code));
    let accountsCreated = 0;
    for (const a of DEFAULT_ACCOUNTS) {
      const exists = a.key ? haveAccounts.some((h) => h.systemKey === a.key) : usedCodes.has(a.code);
      if (exists) continue;
      if (!a.key && usedCodes.has(a.code)) continue;
      let code = a.code;
      while (usedCodes.has(code)) code = String(Number(code) + 1).padStart(4, "0");
      await tx.account.create({ data: { code, name: a.name, type: a.type, systemKey: a.key ?? null } });
      usedCodes.add(code);
      accountsCreated++;
    }

    const report: SeedReport = {
      companySettings: existing ? "kept" : "created",
      sequencesCreated: missing,
      warehouse: warehouseCount === 0 ? "created" : "kept",
      defaultPriceList: priceListCreated ? "created" : "kept",
      taxRatesCreated: missingRates,
      documentDetailsFilled,
      accountsCreated,
    };
    if (
      !existing ||
      missing.length ||
      warehouseCount === 0 ||
      priceListCreated ||
      missingRates.length ||
      documentDetailsFilled.length
    ) {
      await writeAudit(tx, {
        actorLabel: "system:seed",
        action: "SEED_APPLIED",
        entityType: "System",
        summary: "Initial settings created",
        after: report,
      });
    }
    return report;
  });
}
