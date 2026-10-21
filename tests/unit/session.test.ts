import { describe, expect, it, vi } from "vitest";

import { isPublicPath, resolveSession, safeNextPath } from "@/server/auth/resolve";

const row = { id: "u1", email: "a@veejam.test", fullName: "A", role: "SALES" as const, isActive: true };

describe("resolveSession", () => {
  it("no verified claims → anonymous, without touching the database", async () => {
    const lookup = vi.fn();
    expect(await resolveSession(null, lookup)).toEqual({ kind: "anonymous" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("valid Supabase account but no ERP user → no-access", async () => {
    expect(await resolveSession({ sub: "x", email: "x@y.z" }, async () => null)).toEqual({
      kind: "no-access",
      email: "x@y.z",
    });
  });

  it("deactivated ERP user → deactivated (even with a valid token)", async () => {
    expect(await resolveSession({ sub: "x" }, async () => ({ ...row, isActive: false }))).toEqual({
      kind: "deactivated",
      email: row.email,
    });
  });

  it("active user → user with role, looked up by the token subject", async () => {
    const lookup = vi.fn().mockResolvedValue(row);
    const s = await resolveSession({ sub: "auth-123" }, lookup);
    expect(lookup).toHaveBeenCalledWith("auth-123");
    expect(s).toEqual({ kind: "user", user: { id: "u1", email: row.email, fullName: "A", role: "SALES" } });
  });
});

describe("public paths", () => {
  it("only sign-in and health are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/settings/users")).toBe(false);
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/healthy")).toBe(false);
    // Share links are public; everything else about documents is not.
    expect(isPublicPath("/d/abc")).toBe(true);
    expect(isPublicPath("/documents/abc/pdf")).toBe(false);
    expect(isPublicPath("/deliveries")).toBe(false);
  });
});

describe("safeNextPath (prevents redirecting users to other sites after sign-in)", () => {
  it.each([
    ["/settings/company", "/settings/company"],
    ["/settings/users?tab=1", "/settings/users?tab=1"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.example/phish", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/login?next=/x", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
