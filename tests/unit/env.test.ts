import { describe, expect, it } from "vitest";

import { getConfigChecks, parseServerEnv } from "@/config/env";

describe("server environment", () => {
  it("starts with safe defaults when nothing is configured", () => {
    const env = parseServerEnv({});
    expect(env.WHATSAPP_PROVIDER).toBe("mock");
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("treats empty strings as not set", () => {
    const env = parseServerEnv({ DATABASE_URL: "", META_APP_SECRET: "   " });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.META_APP_SECRET).toBeUndefined();
  });

  it("requires every Meta setting when the Meta provider is selected", () => {
    expect(() => parseServerEnv({ WHATSAPP_PROVIDER: "meta" })).toThrow(/META_APP_SECRET is required/);
  });

  it("rejects an unknown WhatsApp provider", () => {
    expect(() => parseServerEnv({ WHATSAPP_PROVIDER: "whatsapp-web" })).toThrow();
  });

  it("validates the owner WhatsApp number format", () => {
    expect(
      parseServerEnv({ VEEJAM_OWNER_WHATSAPP_NUMBER: "254712345678" }).VEEJAM_OWNER_WHATSAPP_NUMBER,
    ).toBe("254712345678");
    expect(() => parseServerEnv({ VEEJAM_OWNER_WHATSAPP_NUMBER: "+254712345678" })).toThrow(/digits only/);
    expect(() => parseServerEnv({ VEEJAM_OWNER_WHATSAPP_NUMBER: "0712345678" })).toThrow(/digits only/);
  });

  it("reports configuration status without exposing values", () => {
    const secret = "super-secret-token-value";
    const checks = getConfigChecks(
      parseServerEnv({
        META_WHATSAPP_TOKEN: secret,
        META_WHATSAPP_PHONE_NUMBER_ID: "123",
        META_APP_SECRET: secret,
      }),
    );
    expect(checks.find((c) => c.key === "META_WHATSAPP_TOKEN")?.configured).toBe(true);
    expect(JSON.stringify(checks)).not.toContain(secret);
  });
});
