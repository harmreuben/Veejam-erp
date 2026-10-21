import path from "node:path";

import { describe, expect, it } from "vitest";

import { planPgConnection } from "@/server/db/connection";

const REMOTE =
  "postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=30&pgbouncer=true";
// Paths are resolved the same way the app does, so the test works on Windows and Linux.
const CWD = path.resolve("/app");
const at = (relative: string) => path.resolve(CWD, relative);
const fs = (files: Record<string, string>) => ({
  cwd: CWD,
  fileExists: (p: string) => p in files,
  readFile: (p: string) => files[p] ?? "",
});

describe("database connection security", () => {
  it("local test databases connect without TLS", () => {
    const plan = planPgConnection("postgresql://u:p@localhost:5432/veejam_test", fs({}));
    expect(plan.tls).toBe("none");
    expect(plan.config.ssl).toBeUndefined();
  });

  it("remote databases are always encrypted; options meant for other tools are removed", () => {
    const plan = planPgConnection(REMOTE, fs({}));
    expect(plan.tls).toBe("encrypted-unverified");
    expect(plan.config.ssl).toEqual({ rejectUnauthorized: false });
    expect(plan.config.connectionString).toBe(
      "postgresql://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    );
  });

  it("verifies the server certificate when the Supabase CA file is present", () => {
    const plan = planPgConnection(
      REMOTE,
      fs({ [at("certs/supabase-ca.crt")]: "-----BEGIN CERTIFICATE-----x" }),
    );
    expect(plan.tls).toBe("verified");
    expect(plan.config.ssl).toEqual({ ca: "-----BEGIN CERTIFICATE-----x", rejectUnauthorized: true });
  });

  it("uses DATABASE_SSL_CA_PATH when given, and fails loudly if that file is missing", () => {
    const files = fs({ [at("custom/ca.pem")]: "CA" });
    expect(planPgConnection(REMOTE, { ...files, caPath: "custom/ca.pem" }).tls).toBe("verified");
    expect(() => planPgConnection(REMOTE, { ...files, caPath: "missing.pem" })).toThrow(/doesn't exist/);
  });
});
