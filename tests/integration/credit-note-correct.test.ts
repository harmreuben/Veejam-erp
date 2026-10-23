import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi } from "@/lib/dates";
import { effectivePermissions } from "@/server/auth/permissions";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { trialBalance } from "@/server/modules/accounting/service";
import { createCustomer } from "@/server/modules/customers/service";
import {
  applyCredit,
  customerBalance,
  customerStatement,
  recordPayment,
} from "@/server/modules/payments/service";
import {
  correctCreditNote,
  correctionForm,
  deleteCreditNote,
} from "@/server/modules/sales/correct-credit-note";
import { createCreditNote, creditableLines } from "@/server/modules/sales/credit-notes";
import { listDocuments } from "@/server/modules/sales/queries";
import { createDraft, postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";

import { clearTestData, rawQuery } from "./db";
import { makeUser, testDb } from "./helpers";
import { addStock, balance, mainWarehouse, makeProduct } from "./phase3-helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

const today = () => todayInNairobi();

async function setup() {
  const owner = await makeUser(db, "OWNER");
  const admin = await makeUser(db, "ADMIN");
  const accountant = await makeUser(db, "ACCOUNTANT");
  // 200 pieces a carton, KES 1,900 a carton, costing KES 5 a piece.
  const product = await makeProduct(db, owner, { prices: { CARTON: "1900" }, costPrice: "5" });
  const main = await mainWarehouse(db);
  await addStock(db, owner, product.id, main.id, 1000);
  await db.inventoryValuation.update({ where: { productId: product.id }, data: { value: "5000.00" } });
  const customer = await createCustomer(db, owner, {
    name: `Customer ${randomUUID().slice(0, 6)}`,
    type: "WHOLESALER",
    creditLimit: "1000000",
    paymentTermsDays: 14,
  });
  return { owner, admin, accountant, product, main, customer };
}
type S = Awaited<ReturnType<typeof setup>>;

async function invoice(s: S, cartons: number) {
  const { id } = await createDraft(db, s.owner, "INVOICE", {
    customerId: s.customer.id,
    warehouseId: s.main.id,
    issueDate: today(),
    lines: [{ productId: s.product.id, unit: "CARTON", quantity: cartons }],
  });
  await postInvoice(db, s.owner, id, { version: 1 });
  return db.salesDocument.findUniqueOrThrow({ where: { id } });
}

async function credit(s: S, invoiceId: string, cartons: number, returnsToStock = false) {
  const lines = await creditableLines(db, s.owner, invoiceId);
  return createCreditNote(db, s.accountant, invoiceId, {
    idempotencyKey: randomUUID(),
    reason: "Damaged in transit",
    returnsToStock: returnsToStock ? "on" : undefined,
    lines: [{ lineId: lines.lines[0]!.id, quantity: cartons }],
  });
}

async function accounts(s: S) {
  const tb = await trialBalance(db, s.owner);
  const by = (k: string) => tb.rows.find((r) => r.systemKey === k)?.balance ?? "0.00";
  return {
    balanced: tb.balanced,
    AR: by("AR"),
    RETURNS: by("SALES_RETURNS"),
    VAT: by("VAT_OUTPUT"),
    COGS: by("COGS"),
    INV: by("INVENTORY"),
  };
}

const version = async (id: string) => (await db.salesDocument.findUniqueOrThrow({ where: { id } })).version;

describe("correcting a credit note (owners and admins)", () => {
  it("replaces it with a new one: credit, stock and ledger end up as if only the new one was issued", async () => {
    const s = await setup();
    const inv = await invoice(s, 3); // 5,700; 600 pieces out
    const cn = await credit(s, inv.id, 2, true); // 3,800; 400 pieces back
    expect(await balance(db, s.product.id, s.main.id)).toBe(800);

    // Corrected to one carton, not back in stock.
    const form = await correctionForm(db, s.admin, cn.id);
    expect(form.lines[0]).toMatchObject({ remaining: 3, current: 2 });
    expect(form.invoice.outstanding).toBe("5700.00");

    const key = randomUUID();
    const input = {
      version: await version(cn.id),
      idempotencyKey: key,
      why: "Only one carton was damaged",
      reason: "1 carton damaged in transit",
      lines: [{ lineId: form.lines[0]!.id, quantity: 1 }],
    };
    const r = await correctCreditNote(db, s.admin, cn.id, input);
    expect(r).toMatchObject({ number: "CN-000002", replaced: "CN-000001", alreadyDone: false });
    // Sending the form again does nothing more.
    expect(await correctCreditNote(db, s.admin, cn.id, input)).toMatchObject({
      id: r.id,
      alreadyDone: true,
    });

    const old = await db.salesDocument.findUniqueOrThrow({ where: { id: cn.id } });
    expect(old).toMatchObject({ status: "CANCELLED" });
    expect(old.deletedAt).not.toBeNull();
    const fresh = await db.salesDocument.findUniqueOrThrow({ where: { id: r.id } });
    expect(fresh).toMatchObject({
      status: "POSTED",
      replacesId: cn.id,
      notes: "1 carton damaged in transit",
    });
    expect(fresh.total.toFixed(2)).toBe("1900.00");

    // The goods that went back into stock are out again; the new one returns nothing.
    expect(await balance(db, s.product.id, s.main.id)).toBe(400);
    expect(
      (await db.inventoryValuation.findUniqueOrThrow({ where: { productId: s.product.id } })).value.toFixed(
        2,
      ),
    ).toBe("2000.00");
    // The invoice owes 5,700 less only the new 1,900.
    const after = await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.amountCredited.toFixed(2)).toBe("1900.00");
    expect((await customerBalance(db, s.customer.id)).balance).toBe("3800.00");

    const a = await accounts(s);
    expect(a.balanced).toBe(true);
    expect(a.RETURNS).toBe("-1637.93");
    expect(a.INV).toBe("2000.00"); // the stock account matches the stock value: 400 pieces at KES 5
    // Lists and statements: only the new one.
    const list = await listDocuments(db, s.owner, "CREDIT_NOTE");
    expect(list.map((d) => d.number)).toEqual(["CN-000002"]);
    const deleted = await listDocuments(db, s.owner, "CREDIT_NOTE", { status: "DELETED" });
    expect(deleted.map((d) => d.number)).toEqual(["CN-000001"]);
    const st = await customerStatement(db, s.owner, s.customer.id);
    expect(st.lines.filter((l) => l.kind === "Credit note").map((l) => l.reference)).toEqual(["CN-000002"]);

    // The old one is frozen.
    await expect(
      rawQuery(`UPDATE sales_documents SET notes = 'x' WHERE number = 'CN-000001'`),
    ).rejects.toThrow(/cannot be changed/);
  });

  it("credit the old one had applied to another invoice is applied to it again", async () => {
    const s = await setup();
    // Invoice A is paid in full, so a credit note on it becomes credit on the account...
    const a = await invoice(s, 1);
    await recordPayment(db, s.owner, {
      customerId: s.customer.id,
      receivedOn: today(),
      method: "CASH",
      amount: "1900",
      idempotencyKey: randomUUID(),
    });
    const b = await invoice(s, 1);
    const cn = await credit(s, a.id, 1);
    // ...which was then used to pay invoice B.
    await applyCredit(
      db,
      s.owner,
      { creditNoteId: cn.id },
      { allocations: [{ invoiceId: b.id, amount: "1900" }] },
    );

    const form = await correctionForm(db, s.owner, cn.id);
    const r = await correctCreditNote(db, s.owner, cn.id, {
      version: await version(cn.id),
      idempotencyKey: randomUUID(),
      why: "Reason was wrong",
      reason: "Overcharged on price",
      lines: [{ lineId: form.lines[0]!.id, quantity: 1 }],
    });
    // B is still paid, now by the corrected credit note.
    const bAfter = await db.salesDocument.findUniqueOrThrow({
      where: { id: b.id },
      include: { allocationsReceived: { where: { reversedAt: null }, include: { creditNote: true } } },
    });
    expect(bAfter.amountCredited.toFixed(2)).toBe("1900.00");
    expect(bAfter.allocationsReceived.map((x) => x.creditNote?.number)).toEqual([r.number]);
    expect(await customerBalance(db, s.customer.id)).toMatchObject({
      balance: "0.00",
      unappliedCredit: "0.00",
    });
    expect((await accounts(s)).balanced).toBe(true);
  });

  it("refuses: no change, stale version, others' roles, and goods that have gone out again", async () => {
    const s = await setup();
    const inv = await invoice(s, 2);
    const cn = await credit(s, inv.id, 1, true);
    const form = await correctionForm(db, s.owner, cn.id);
    const base = {
      idempotencyKey: randomUUID(),
      why: "Checking",
      reason: "Damaged in transit",
      returnsToStock: "on",
      lines: [{ lineId: form.lines[0]!.id, quantity: 1 }],
    };
    await expect(
      correctCreditNote(db, s.owner, cn.id, { ...base, version: await version(cn.id) }),
    ).rejects.toThrow(ValidationError);
    await expect(
      correctCreditNote(db, s.owner, cn.id, { ...base, reason: "Changed", version: 99 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      deleteCreditNote(db, s.accountant, cn.id, { version: await version(cn.id), why: "x y z" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Can't be given to anyone else.
    expect(
      effectivePermissions("ACCOUNTANT", [{ permission: "credit_notes.edit", granted: true }]),
    ).not.toContain("credit_notes.edit");

    // The returned 200 pieces are sold again: stock can't take them back out.
    const all = await balance(db, s.product.id, s.main.id); // 800
    await invoice(s, all / 200);
    await expect(
      deleteCreditNote(db, s.owner, cn.id, { version: await version(cn.id), why: "Issued by mistake" }),
    ).rejects.toThrow(/gone out again/);
    // Nothing changed.
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id: cn.id } })).status).toBe("POSTED");
  });
});

describe("deleting a credit note", () => {
  it("undoes it fully and hides it; the invoice owes it all again", async () => {
    const s = await setup();
    const before = await accounts(s);
    const inv = await invoice(s, 1);
    const cn = await credit(s, inv.id, 1, true);
    const r = await deleteCreditNote(db, s.admin, cn.id, {
      version: await version(cn.id),
      why: "Issued on the wrong invoice",
    });
    expect(r).toMatchObject({ number: "CN-000001", total: "1900.00" });
    expect(
      (await db.salesDocument.findUniqueOrThrow({ where: { id: inv.id } })).amountCredited.toFixed(2),
    ).toBe("0.00");
    expect((await customerBalance(db, s.customer.id)).balance).toBe("1900.00");
    expect(await balance(db, s.product.id, s.main.id)).toBe(800);
    const a = await accounts(s);
    expect(a.balanced).toBe(true);
    expect(a.RETURNS).toBe(before.RETURNS);
    expect(a.INV).toBe("4000.00"); // 800 pieces at KES 5
    // It can be credited afresh.
    expect((await creditableLines(db, s.owner, inv.id)).lines[0]!.remaining).toBe(1);
    await expect(
      deleteCreditNote(db, s.admin, cn.id, { version: await version(cn.id), why: "Again" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
