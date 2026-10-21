import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { getCompanySettings, updateCompanySettings } from "@/server/modules/settings/service";
import { applySeed } from "@/server/seed";

import { clearTestData } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

async function formFor(version: number) {
  const s = await db.companySettings.findUniqueOrThrow({ where: { id: 1 } });
  return {
    name: s.name,
    telephone: s.telephone,
    documentEmail: s.documentEmail,
    country: s.country,
    currency: s.currency,
    timezone: s.timezone,
    businessType: s.businessType,
    productScope: s.productScope,
    kraPin: s.kraPin ?? "",
    physicalAddress: s.physicalAddress ?? "",
    postalAddress: s.postalAddress ?? "",
    paymentInstructions: s.paymentInstructions ?? "",
    invoiceTerms: s.invoiceTerms ?? "",
    defaultPaymentTermsDays: String(s.defaultPaymentTermsDays),
    version: String(version),
  };
}

describe("company settings", () => {
  it("seed creates VeeJam's details and every role can read them", async () => {
    for (const role of ["OWNER", "ADMIN", "ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
      const actor = await makeUser(db, role);
      const s = await getCompanySettings(db, actor);
      expect(s).toMatchObject({ name: "VeeJam Limited", telephone: "0115924570", currency: "KES" });
    }
  });

  it("owner updates settings; only changed fields are audited, with the actor", async () => {
    const owner = await makeUser(db, "OWNER");
    const form = { ...(await formFor(1)), kraPin: "p051234567x", paymentInstructions: "M-Pesa till 123456" };
    const saved = await updateCompanySettings(db, owner, form, { ipAddress: "10.0.0.1" });

    expect(saved.kraPin).toBe("P051234567X");
    expect(saved.version).toBe(2);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SETTINGS_UPDATED" } });
    expect(audit.actorUserId).toBe(owner.id);
    expect(audit.after).toEqual({ kraPin: "P051234567X", paymentInstructions: "M-Pesa till 123456" });
    expect(audit.before).toEqual({ kraPin: null, paymentInstructions: null });
    expect(audit.ipAddress).toBe("10.0.0.1");
  });

  it("rejects a save based on an out-of-date form (two people editing at once)", async () => {
    const a = await makeUser(db, "OWNER");
    const b = await makeUser(db, "ADMIN");
    const stale = await formFor(1);
    await updateCompanySettings(db, a, { ...stale, telephone: "0711111111" });
    await expect(updateCompanySettings(db, b, { ...stale, telephone: "0722222222" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await db.companySettings.findUniqueOrThrow({ where: { id: 1 } })).telephone).toBe("0711111111");
  });

  it("roles without settings.manage cannot change settings, and nothing is written", async () => {
    for (const role of ["ACCOUNTANT", "SALES", "STOREKEEPER"] as const) {
      const actor = await makeUser(db, role);
      await expect(
        updateCompanySettings(db, actor, { ...(await formFor(1)), name: "Hacked Ltd" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await db.companySettings.findUniqueOrThrow({ where: { id: 1 } })).name).toBe("VeeJam Limited");
    expect(await db.auditLog.count({ where: { action: "SETTINGS_UPDATED" } })).toBe(0);
  });

  it("validates on the server and reports each bad field", async () => {
    const owner = await makeUser(db, "OWNER");
    const bad = {
      ...(await formFor(1)),
      telephone: "123",
      documentEmail: "nope",
      kraPin: "12345",
      defaultPaymentTermsDays: "-1",
    };
    const error = await updateCompanySettings(db, owner, bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fieldErrors).sort()).toEqual(
      ["defaultPaymentTermsDays", "documentEmail", "kraPin", "telephone"].sort(),
    );
  });

  it("saving without changes writes nothing", async () => {
    const owner = await makeUser(db, "OWNER");
    const saved = await updateCompanySettings(db, owner, await formFor(1));
    expect(saved.version).toBe(1);
    expect(await db.auditLog.count({ where: { action: "SETTINGS_UPDATED" } })).toBe(0);
  });

  it("seed is safe to re-run: it keeps edits and never resets numbering", async () => {
    const owner = await makeUser(db, "OWNER");
    await updateCompanySettings(db, owner, { ...(await formFor(1)), name: "VeeJam Ltd" });
    await db.documentSequence.update({ where: { documentType: "INVOICE" }, data: { nextNumber: 126 } });
    const report = await applySeed(db);
    expect(report).toEqual({ companySettings: "kept", sequencesCreated: [] });
    expect((await db.companySettings.findUniqueOrThrow({ where: { id: 1 } })).name).toBe("VeeJam Ltd");
    expect(
      (await db.documentSequence.findUniqueOrThrow({ where: { documentType: "INVOICE" } })).nextNumber,
    ).toBe(126);
  });
});
