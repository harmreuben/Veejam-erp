import "server-only";

import type { CompanySettings } from "@/generated/prisma/client";
import { diffFields, writeAudit } from "@/server/audit/audit";
import { authorize, type Actor } from "@/server/auth/permissions";
import type { Db } from "@/server/db/client";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";

import { findCompanySettings, findSettingsEditorName, updateCompanySettingsIfVersion } from "./repository";
import { companySettingsInputSchema } from "./schemas";

export type CompanySettingsView = Omit<CompanySettings, "updatedById">;

/** Who last saved the settings (null if never edited since setup). */
export async function getSettingsLastEditor(db: Db, actor: Actor): Promise<string | null> {
  authorize(actor, "settings.view");
  return findSettingsEditorName(db);
}

/** Read company settings. Any signed-in role with settings.view may read. */
export async function getCompanySettings(db: Db, actor: Actor): Promise<CompanySettingsView> {
  authorize(actor, "settings.view");
  const row = await findCompanySettings(db);
  if (!row) {
    throw new NotFoundError("Company settings are missing. Run the database seed: npm run db:seed");
  }
  return row;
}

/** Company name for page chrome; no permission needed and never throws. */
export async function getCompanyDisplayName(db: Db, fallback: string): Promise<string> {
  try {
    return (await findCompanySettings(db))?.name ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Update company settings.
 * - Requires settings.manage.
 * - Validates every field on the server.
 * - Fails with ConflictError if someone else saved since the form was loaded.
 * - Writes an audit entry listing only the changed fields, in the same transaction.
 */
export async function updateCompanySettings(
  db: Db,
  actor: Actor,
  input: unknown,
  context: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<CompanySettingsView> {
  authorize(actor, "settings.manage");

  const parsed = companySettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new ValidationError(fieldErrors);
  }
  const { version, ...values } = parsed.data;
  const data = {
    ...values,
    kraPin: values.kraPin ?? null,
    physicalAddress: values.physicalAddress ?? null,
    postalAddress: values.postalAddress ?? null,
    paymentInstructions: values.paymentInstructions ?? null,
    invoiceTerms: values.invoiceTerms ?? null,
    tagline: values.tagline ?? null,
    mpesaPaybill: values.mpesaPaybill ?? null,
    mpesaAccount: values.mpesaAccount ?? null,
  };

  return db.$transaction(async (tx) => {
    const current = await findCompanySettings(tx);
    if (!current) throw new NotFoundError("Company settings are missing. Run the database seed.");

    const changes = diffFields(current as unknown as Record<string, unknown>, data);
    if (!changes) {
      if (current.version !== version) {
        throw new ConflictError("Someone else changed these settings. Reload the page to see their changes.");
      }
      return current;
    }

    const updated = await updateCompanySettingsIfVersion(tx, version, data, actor.id);
    if (updated === 0) {
      throw new ConflictError("Someone else changed these settings. Reload the page to see their changes.");
    }

    await writeAudit(tx, {
      actorUserId: actor.id,
      actorLabel: actor.email,
      action: "SETTINGS_UPDATED",
      entityType: "CompanySettings",
      entityId: String(current.id),
      summary: `Updated ${Object.keys(changes.after).join(", ")}`,
      before: changes.before as never,
      after: changes.after as never,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const saved = await findCompanySettings(tx);
    if (!saved) throw new NotFoundError();
    return saved;
  });
}
