import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { exportAudit, listAudit } from "@/server/audit/queries";
import { createBackup, readBackup, restoreBackup } from "@/server/backup/backup";
import { ForbiddenError } from "@/server/errors";
import { postManualJournal, startAccounting } from "@/server/modules/accounting/service";
import { createCustomer } from "@/server/modules/customers/service";
import { recordPayment } from "@/server/modules/payments/service";
import {
  collectionsReport,
  dashboard,
  profitAndLoss,
  readRange,
  salesReport,
  stockValuation,
  vatReport,
} from "@/server/modules/reports/service";
import { createCreditNote } from "@/server/modules/sales/credit-notes";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";
import { hitLimit, isLimited } from "@/server/security/rate-limit";

import { clearTestData, rebuildTestDatabase, TEST_DATABASE_URL } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

const today = () => todayInNairobi();

async function setup() {
  const owner = await makeUser(db, "OWNER");
  const accountant = await makeUser(db, "ACCOUNTANT");
  const sales = await makeUser(db, "SALES");
  const product = await makeProduct(db, owner, {
    prices: { PACK: "116", CARTON: "2320" },
    costPrice: "8.50",
  });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 4000);
  const customer = await createCustomer(db, owner, {
    name: `Report customer ${randomUUID().slice(0, 4)}`,
    type: "WHOLESALER",
    creditLimit: "1000000",
  });
  const { id } = await createDraft(db, owner, "INVOICE", {
    customerId: customer.id,
    warehouseId: main.id,
    issueDate: today(),
    lines: [{ productId: product.id, unit: "CARTON", quantity: 2 }],
  });
  await postInvoice(db, owner, id, { version: 1 });
  await recordPayment(db, owner, {
    customerId: customer.id,
    receivedOn: today(),
    method: "MPESA",
    reference: "QWE1234567",
    amount: "1000",
    idempotencyKey: randomUUID(),
  });
  return { owner, accountant, sales, product, main, customer, invoiceId: id };
}

describe("reports", () => {
  it("sales, VAT, money received, profit and stock value agree with the documents", async () => {
    const s = await setup();
    await createCreditNote(db, s.owner, s.invoiceId, {
      reason: "One carton returned",
      returnsToStock: true,
      idempotencyKey: randomUUID(),
      lines: [{ lineId: (await db.salesDocumentLine.findFirstOrThrow()).id, quantity: 1 }],
    });
    const range = { from: today(), to: today() };

    const byCustomer = await salesReport(db, s.accountant, range, "customer");
    expect(byCustomer.totals).toMatchObject({
      invoices: 1,
      gross: "4640.00",
      vat: "640.00",
      net: "4000.00",
      returnsGross: "2320.00",
      netGross: "2320.00",
      netSales: "2000.00",
    });
    expect(byCustomer.rows).toEqual([
      expect.objectContaining({ label: s.customer.name, netGross: "2320.00", returnsGross: "2320.00" }),
    ]);
    const byProduct = await salesReport(db, s.accountant, range, "product");
    expect(byProduct.rows[0]).toMatchObject({ pieces: 200, netGross: "2320.00", vat: "320.00" });
    const byDay = await salesReport(db, s.accountant, range, "day");
    expect(byDay.rows).toEqual([expect.objectContaining({ key: today(), netGross: "2320.00" })]);

    const vat = await vatReport(db, s.accountant, range);
    expect(vat.totals).toEqual({
      salesNet: "4000.00",
      salesVat: "640.00",
      returnsNet: "2000.00",
      returnsVat: "320.00",
      netVat: "320.00",
    });

    const money = await collectionsReport(db, s.accountant, range);
    expect(money).toMatchObject({
      total: "1000.00",
      count: 1,
      methodTotals: { MPESA: "1000.00", CASH: "0.00" },
    });

    await postManualJournal(db, s.owner, {
      date: today(),
      description: "Rent",
      lines: [
        {
          accountId: (await db.account.findFirstOrThrow({ where: { code: "6000" } })).id,
          debit: "500",
          credit: "",
        },
        {
          accountId: (await db.account.findFirstOrThrow({ where: { code: "1000" } })).id,
          debit: "",
          credit: "500",
        },
      ],
    });
    const pl = await profitAndLoss(db, s.accountant, range);
    expect(pl).toMatchObject({
      totalIncome: "2000.00",
      // Rent 500 + cost of the 200 pieces sold net of returns at 8.50 = 1,700.
      totalExpenses: "2200.00",
      result: "-200.00",
      cogsPosted: true,
    });

    const stock = await stockValuation(db, s.accountant);
    expect(stock).toMatchObject({ total: (3800 * 8.5).toFixed(2), missing: 0 });

    const dash = await dashboard(db, s.owner);
    expect(dash.todaySales.netGross).toBe("2320.00");
    expect(dash.monthReceived).toBe("1000.00");
    expect(dash.owed).toBe("1320.00");
    expect(dash.trend).toHaveLength(30);
    expect(dash.trend.at(-1)).toEqual({ day: today(), sales: "2320.00", received: "1000.00" });
  });

  it("sales staff can't see reports; ranges are checked", async () => {
    const s = await setup();
    await expect(salesReport(db, s.sales, { from: today(), to: today() }, "day")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(stockValuation(db, s.sales)).rejects.toBeInstanceOf(ForbiddenError);
    expect(() => readRange({ from: "2026-10-10", to: "2026-10-01" })).toThrow();
    expect(() => readRange({ from: "2019-01-01", to: "2026-10-01" })).toThrow();
    expect(readRange({ from: "garbage", to: "2026-10-05" }).to).toBe("2026-10-05");
  });
});

describe("audit viewer", () => {
  it("filters, pages and records its own exports", async () => {
    const s = await setup();
    const all = await listAudit(db, s.owner, {});
    expect(all.rows.length).toBeGreaterThan(3);
    expect(all.actions).toContain("INVOICE_POSTED");
    const posted = await listAudit(db, s.owner, { action: "INVOICE_POSTED" });
    expect(posted.rows.every((r) => r.action === "INVOICE_POSTED")).toBe(true);
    const older = await listAudit(db, s.owner, { before: all.rows[0]!.id });
    expect(older.rows[0]!.id).toBe(all.rows[1]!.id);
    await exportAudit(db, s.owner, { action: "INVOICE_POSTED" });
    expect(await db.auditLog.count({ where: { action: "AUDIT_EXPORTED" } })).toBe(1);
    await expect(listAudit(db, s.sales, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("rate limits", () => {
  it("count per key and window, and say when to retry", async () => {
    const rule = { limit: 3, windowSeconds: 60 };
    const now = new Date("2026-10-21T10:00:30Z");
    for (let i = 1; i <= 3; i++) expect((await hitLimit(db, "k", rule, now)).allowed).toBe(true);
    const over = await hitLimit(db, "k", rule, now);
    expect(over).toEqual({ allowed: false, count: 4, retryAfterSeconds: 30 });
    expect((await isLimited(db, "k", rule, now)).allowed).toBe(false);
    expect((await isLimited(db, "other", rule, now)).allowed).toBe(true);
    // Next window starts fresh.
    expect((await hitLimit(db, "k", rule, new Date("2026-10-21T10:01:00Z"))).allowed).toBe(true);
  });
});

describe("backups", () => {
  const RESTORE_URL = TEST_DATABASE_URL.replace(/\/([^/?]+)(\?|$)/, "/$1_restore$2");
  const PASS = "correct horse battery staple";

  async function freshRestoreDb() {
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    const name = new URL(RESTORE_URL).pathname.slice(1);
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    await admin.end();
    await rebuildTestDatabase(RESTORE_URL);
  }

  it("restores every row exactly into an empty database, and refuses a non-empty one", async () => {
    await setup();
    await startAccounting(db, (await db.user.findFirstOrThrow({ where: { role: "OWNER" } })) as never);
    const { file, bundle, totalRows } = await createBackup(TEST_DATABASE_URL, PASS, "test");
    expect(file.subarray(0, 4).toString()).toBe("VJB1");
    expect(file.includes(Buffer.from("Report customer"))).toBe(false); // encrypted, not just zipped
    expect(bundle.tables.find((t) => t.name === "sales_documents")!.rows).toBe(1);
    expect(bundle.tables.some((t) => t.name === "rate_limits")).toBe(false);

    await freshRestoreDb();
    const report = await restoreBackup(RESTORE_URL, readBackup(file, PASS));
    expect(report.verified).toBe(true);
    expect(report.totalRows).toBe(totalRows);

    // Numbering and the audit log carry on after the restored rows; triggers are back on.
    const restored = new pg.Client({ connectionString: RESTORE_URL });
    await restored.connect();
    try {
      await restored.query("INSERT INTO audit_log (actor_label, action, entity_type) VALUES ('t', 'X', 'Y')");
      await expect(
        restored.query("UPDATE sales_documents SET total = 1 WHERE status = 'POSTED'"),
      ).rejects.toThrow();
    } finally {
      await restored.end();
    }

    await expect(restoreBackup(RESTORE_URL, readBackup(file, PASS))).rejects.toThrow(/isn't empty/);
  });

  it("a wrong passphrase or a changed byte is refused", async () => {
    await setup();
    const { file } = await createBackup(TEST_DATABASE_URL, PASS, "test");
    expect(() => readBackup(file, "wrong passphrase!!")).toThrow(/Wrong passphrase/);
    const tampered = Buffer.from(file);
    tampered[tampered.length - 5]! ^= 0xff;
    expect(() => readBackup(tampered, PASS)).toThrow(/damaged/);
    await expect(createBackup(TEST_DATABASE_URL, "short", "test")).rejects.toThrow(/BACKUP_PASSPHRASE/);
  });
});
