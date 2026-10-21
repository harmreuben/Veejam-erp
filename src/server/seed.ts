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
};

export type SeedReport = { companySettings: "created" | "kept"; sequencesCreated: DocumentType[] };

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

    const report: SeedReport = { companySettings: existing ? "kept" : "created", sequencesCreated: missing };
    if (!existing || missing.length) {
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
