import "server-only";

import type { CompanySettings } from "@/generated/prisma/client";
import type { DbOrTx } from "@/server/db/client";

export const COMPANY_SETTINGS_ID = 1;

export function findCompanySettings(db: DbOrTx): Promise<CompanySettings | null> {
  return db.companySettings.findUnique({ where: { id: COMPANY_SETTINGS_ID } });
}

/**
 * Update only if the stored version still matches `expectedVersion`.
 * Returns the number of rows updated (0 means someone else saved first).
 */
export async function updateCompanySettingsIfVersion(
  db: DbOrTx,
  expectedVersion: number,
  data: Omit<CompanySettings, "id" | "version" | "updatedAt" | "updatedById">,
  updatedById: string,
): Promise<number> {
  const result = await db.companySettings.updateMany({
    where: { id: COMPANY_SETTINGS_ID, version: expectedVersion },
    data: { ...data, updatedById, version: { increment: 1 } },
  });
  return result.count;
}

export async function findSettingsEditorName(db: DbOrTx): Promise<string | null> {
  const row = await db.companySettings.findUnique({
    where: { id: COMPANY_SETTINGS_ID },
    select: { updatedBy: { select: { fullName: true } } },
  });
  return row?.updatedBy?.fullName ?? null;
}
