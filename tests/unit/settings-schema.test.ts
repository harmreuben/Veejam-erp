import { describe, expect, it } from "vitest";

import { DEFAULT_COMPANY_PROFILE } from "@/config/company";
import { legacyKindFromFileName, parseLegacyFile } from "@/server/modules/legacy/staging";
import { companySettingsInputSchema } from "@/server/modules/settings/schemas";

const base = { ...DEFAULT_COMPANY_PROFILE, defaultPaymentTermsDays: "0", version: "1" };

describe("company settings validation", () => {
  it("normalises the KRA PIN and currency, and turns blanks into null", () => {
    const v = companySettingsInputSchema.parse({
      ...base,
      kraPin: " p051234567x ",
      currency: "kes",
      invoiceTerms: "  ",
    });
    expect(v.kraPin).toBe("P051234567X");
    expect(v.currency).toBe("KES");
    expect(v.invoiceTerms).toBeNull();
  });

  it.each(["P05123456X", "1051234567X", "P0512345678", "PP51234567X"])("rejects KRA PIN %s", (kraPin) => {
    expect(companySettingsInputSchema.safeParse({ ...base, kraPin }).success).toBe(false);
  });

  it("allows an empty KRA PIN", () => {
    expect(companySettingsInputSchema.parse({ ...base, kraPin: "" }).kraPin).toBeNull();
  });

  it("bounds payment terms to 0–365 whole days", () => {
    for (const d of ["-1", "366", "1.5", "abc"]) {
      expect(companySettingsInputSchema.safeParse({ ...base, defaultPaymentTermsDays: d }).success).toBe(
        false,
      );
    }
    expect(
      companySettingsInputSchema.parse({ ...base, defaultPaymentTermsDays: "30" }).defaultPaymentTermsDays,
    ).toBe(30);
  });
});

describe("legacy file recognition", () => {
  it("maps export names to their kind", () => {
    expect(legacyKindFromFileName("invoices-2026-10-21.csv")).toBe("invoices");
    expect(legacyKindFromFileName("C:\\data\\invoice-line-items-2026-10-21.csv")).toBe("invoice-line-items");
    expect(legacyKindFromFileName("products-inventory.csv")).toBe("products-inventory");
    expect(legacyKindFromFileName("invoices-final.csv")).toBeNull();
  });

  it("keeps values as text and handles quotes, commas, newlines and a BOM", () => {
    const csv =
      '\uFEFFsku,name,unit_price,wholesale_price,stock_quantity\nWRG-001,"Juicy Fruit 10\'s, box",600,580,925\n';
    const parsed = parseLegacyFile("products-inventory-2026-10-21.csv", Buffer.from(csv));
    expect(parsed.columns[0]).toBe("sku");
    expect(parsed.rows[0]).toEqual({
      sku: "WRG-001",
      name: "Juicy Fruit 10's, box",
      unit_price: "600",
      wholesale_price: "580",
      stock_quantity: "925",
    });
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
