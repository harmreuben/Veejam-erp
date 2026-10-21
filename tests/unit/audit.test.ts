import { describe, expect, it } from "vitest";

import { diffFields, redact } from "@/server/audit/audit";

describe("audit helpers", () => {
  it("redacts secrets at any depth, keeps everything else", () => {
    expect(
      redact({
        email: "a@b.c",
        password: "hunter2",
        nested: { accessToken: "abc", appSecret: "s", kraPin: "P051234567X" },
        list: [{ temporaryPassword: "x" }],
      }),
    ).toEqual({
      email: "a@b.c",
      password: "[redacted]",
      nested: { accessToken: "[redacted]", appSecret: "[redacted]", kraPin: "P051234567X" },
      list: [{ temporaryPassword: "[redacted]" }],
    });
  });

  it("diffFields returns only changed fields, or null", () => {
    expect(diffFields({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: null })).toEqual({
      before: { b: "x" },
      after: { b: "y" },
    });
    expect(diffFields({ a: 1 }, { a: 1 })).toBeNull();
    expect(diffFields({ a: null } as Record<string, unknown>, { a: undefined })).toBeNull();
  });
});
