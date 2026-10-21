import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ValidationError } from "@/server/errors";
import { stageLegacyFile } from "@/server/modules/legacy/staging";

import { clearTestData } from "./db";
import { testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(() => clearTestData());

const actor = { id: null, label: "test" };
const payments = Buffer.from(
  "date,invoice_number,customer_name,amount,payment_method,reference_number,received_by,notes\n" +
    "2026-09-12T06:59:55.342000,VJL-A,Lasty,6435,Cash,,,\n" +
    '2026-09-12T06:53:57.943000,VJL-B,"Martin, Carni",17600,M-Pesa,QX1,,"multi\nline note"\n',
);

describe("legacy staging", () => {
  it("stores every row unchanged, with spreadsheet row numbers, and audits it", async () => {
    const result = await stageLegacyFile(db, "payments-2026-10-21.csv", payments, actor);
    expect(result).toEqual({
      fileName: "payments-2026-10-21.csv",
      kind: "payments",
      rows: 2,
      status: "staged",
    });

    const rows = await db.legacyRow.findMany({ orderBy: { rowNumber: "asc" } });
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(rows[1]?.data).toMatchObject({
      customer_name: "Martin, Carni",
      amount: "17600",
      notes: "multi\nline note",
    });
    expect(await db.auditLog.count({ where: { action: "LEGACY_FILE_STAGED" } })).toBe(1);
  });

  it("staging the same file twice does nothing the second time", async () => {
    await stageLegacyFile(db, "payments-2026-10-21.csv", payments, actor);
    const again = await stageLegacyFile(db, "payments-2026-10-21.csv", payments, actor);
    expect(again.status).toBe("already staged");
    expect(await db.legacyImportBatch.count()).toBe(1);
    expect(await db.legacyRow.count()).toBe(2);
  });

  it("rejects unknown files and files missing required columns, storing nothing", async () => {
    await expect(stageLegacyFile(db, "salaries.csv", payments, actor)).rejects.toBeInstanceOf(
      ValidationError,
    );
    const error = await stageLegacyFile(
      db,
      "payments-2026-10-21.csv",
      Buffer.from("date,amount\n2026-01-01,5\n"),
      actor,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.file?.[0]).toMatch(
      /missing column\(s\): invoice_number, payment_method/,
    );
    expect(await db.legacyImportBatch.count()).toBe(0);
  });
});
