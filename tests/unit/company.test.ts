import { describe, expect, it } from "vitest";

import { companyProfileSchema, DEFAULT_COMPANY_PROFILE } from "@/config/company";

describe("company profile", () => {
  it("holds VeeJam's configured details", () => {
    expect(DEFAULT_COMPANY_PROFILE).toMatchObject({
      name: "VeeJam Limited",
      telephone: "0115924570",
      documentEmail: "wanjiruvenus980@gmail.com",
      currency: "KES",
      timezone: "Africa/Nairobi",
    });
  });

  it("rejects invalid edits", () => {
    const bad = { ...DEFAULT_COMPANY_PROFILE, telephone: "12345", documentEmail: "not-an-email" };
    const result = companyProfileSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts Kenyan numbers in local and international form", () => {
    for (const telephone of ["0712345678", "+254712345678", "254115924570"]) {
      expect(companyProfileSchema.safeParse({ ...DEFAULT_COMPANY_PROFILE, telephone }).success).toBe(true);
    }
  });
});
