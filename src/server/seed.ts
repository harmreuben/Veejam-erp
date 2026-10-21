import "server-only";

import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import type { DocumentType } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit/audit";
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
};

/** Structural starting points (renameable). Not business data: no products, customers or prices. */
export const DEFAULT_WAREHOUSE = { code: "MAIN", name: "Main store" };
export const DEFAULT_PRICE_LIST = { code: "STANDARD", name: "Standard prices", pricesIncludeTax: true };

export type SeedReport = {
  companySettings: "created" | "kept";
  sequencesCreated: DocumentType[];
  warehouse: "created" | "kept";
  defaultPriceList: "created" | "kept";
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

    const report: SeedReport = {
      companySettings: existing ? "kept" : "created",
      sequencesCreated: missing,
      warehouse: warehouseCount === 0 ? "created" : "kept",
      defaultPriceList: priceListCreated ? "created" : "kept",
    };
    if (!existing || missing.length || warehouseCount === 0 || priceListCreated) {
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
