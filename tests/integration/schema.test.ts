import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  AuditLogScalarFieldEnum,
  CompanySettingsScalarFieldEnum,
  DocumentSequenceScalarFieldEnum,
  LegacyImportBatchScalarFieldEnum,
  LegacyRowScalarFieldEnum,
  UserScalarFieldEnum,
} from "@/generated/prisma/internal/prismaNamespace";
import { DocumentType, UserRole } from "@/generated/prisma/enums";

import { clearTestData, rawQuery } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => clearTestData());

/** camelCase Prisma field → snake_case column, matching the @map convention used in schema.prisma. */
const toColumn = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const MODELS = {
  users: UserScalarFieldEnum,
  company_settings: CompanySettingsScalarFieldEnum,
  document_sequences: DocumentSequenceScalarFieldEnum,
  audit_log: AuditLogScalarFieldEnum,
  legacy_import_batches: LegacyImportBatchScalarFieldEnum,
  legacy_rows: LegacyRowScalarFieldEnum,
} as const;

describe("migrations match the Prisma schema", () => {
  it("every Prisma field has a column, and no column is missing from Prisma", async () => {
    for (const [table, fields] of Object.entries(MODELS)) {
      const cols = await rawQuery<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
        [table],
      );
      const actual = cols.map((c) => c.column_name).sort();
      const expected = Object.values(fields).map(toColumn).sort();
      expect(actual, table).toEqual(expected);
    }
  });

  it("database enums have exactly the Prisma enum values", async () => {
    const values = async (type: string) =>
      (await rawQuery<{ v: string }>('SELECT unnest(enum_range(NULL::"' + type + '"))::text AS v')).map(
        (r) => r.v,
      );
    expect(await values("UserRole")).toEqual(Object.values(UserRole));
    expect(await values("DocumentType")).toEqual(Object.values(DocumentType));
  });

  it("row-level security is enabled on every table (blocks the Supabase Data API)", async () => {
    const rows = await rawQuery<{ relname: string; relrowsecurity: boolean }>(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
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
