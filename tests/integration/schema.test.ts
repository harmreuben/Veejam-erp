import { readFileSync } from "node:fs";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import * as PrismaEnums from "@/generated/prisma/enums";

import { clearTestData, rawQuery } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => clearTestData());

type RuntimeField = { name: string; kind: "scalar" | "enum" | "object"; dbName?: string };
type RuntimeModel = { dbName: string | null; fields: RuntimeField[] };

/** Prisma's own description of every model, as generated from schema.prisma. */
function prismaModels(): Record<string, RuntimeModel> {
  const source = readFileSync("src/generated/prisma/internal/class.ts", "utf8");
  const match = source.match(/config\.runtimeDataModel = JSON\.parse\((".*")\)/);
  if (!match?.[1]) throw new Error("Could not find the runtime data model in the generated client");
  return (JSON.parse(JSON.parse(match[1])) as { models: Record<string, RuntimeModel> }).models;
}

const MODELS = prismaModels();
const tableOf = (name: string, m: RuntimeModel) => m.dbName ?? name;

describe("migrations match the Prisma schema", () => {
  it("every model has a table and every table has a model", async () => {
    const tables = (
      await rawQuery<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'",
      )
    ).map((t) => t.tablename);
    expect(tables.sort()).toEqual(
      Object.entries(MODELS)
        .map(([n, m]) => tableOf(n, m))
        .sort(),
    );
  });

  it.each(Object.entries(MODELS))("%s: columns match field for field", async (name, model) => {
    const cols = await rawQuery<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
      [tableOf(name, model)],
    );
    const expected = model.fields.filter((f) => f.kind !== "object").map((f) => f.dbName ?? f.name);
    expect(cols.map((c) => c.column_name).sort()).toEqual(expected.sort());
  });

  it("every database enum has exactly the Prisma enum values, in order", async () => {
    const enums = Object.entries(PrismaEnums).filter(([, v]) => typeof v === "object" && v !== null) as [
      string,
      Record<string, string>,
    ][];
    expect(enums.length).toBeGreaterThanOrEqual(10);
    for (const [name, values] of enums) {
      const rows = await rawQuery<{ v: string }>(`SELECT unnest(enum_range(NULL::"${name}"))::text AS v`);
      expect(
        rows.map((r) => r.v),
        name,
      ).toEqual(Object.values(values));
    }
  });

  it("row-level security is enabled on every table (blocks the Supabase Data API)", async () => {
    const rows = await rawQuery<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'",
    );
    expect(rows.length).toBe(Object.keys(MODELS).length);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });
});

describe("database rules", () => {
  it("audit log rejects updates and deletes", async () => {
    await db.auditLog.create({ data: { actorLabel: "test", action: "SEED_APPLIED", entityType: "System" } });
    await expect(db.auditLog.updateMany({ data: { summary: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await db.auditLog.count()).toBe(1);
  });

  it("company settings can only have one row", async () => {
    await expect(
      rawQuery(
        `INSERT INTO company_settings (id,name,telephone,document_email,country,currency,timezone,business_type,product_scope,updated_at)
       VALUES (2,'X','0700000000','a@b.c','Kenya','KES','Africa/Nairobi','x','y',now())`,
      ),
    ).rejects.toThrow(/company_settings_singleton_chk/);
  });

  it("a deactivated user must record when", async () => {
    const u = await makeUser(db, "SALES");
    await expect(rawQuery("UPDATE users SET is_active=false WHERE id=$1", [u.id])).rejects.toThrow(
      /users_deactivation_chk/,
    );
  });

  it("emails are stored lowercase", async () => {
    await expect(makeUser(db, "SALES", { email: "Mixed@VeeJam.test" })).rejects.toThrow();
  });
});
