import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi, addDays } from "@/lib/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createCustomer } from "@/server/modules/customers/service";
import { getDefaultPriceListId, savePrices } from "@/server/modules/pricing/service";
import {
  createShareLink,
  resolveShareToken,
  revokeShareLink,
  updateTaxRate,
} from "@/server/modules/sales/extras";
import { loadPrintableDocument, renderPdf } from "@/server/modules/sales/pdf";
import { getDocument } from "@/server/modules/sales/queries";
import { cancelDocument, createDraft, postInvoice, updateDraft } from "@/server/modules/sales/service";
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

/** Owner, a product at KES 10/piece, 95/pack, 1,900/carton (VAT inclusive), 2 cartons in stock. */
async function setup(opts: { stockPieces?: number; creditLimit?: string } = {}) {
  const owner = await makeUser(db, "OWNER");
  const sales = await makeUser(db, "SALES");
  const product = await makeProduct(db, owner, { prices: { PIECE: "10", PACK: "95", CARTON: "1900" } });
  const main = await mainWarehouse(db);
  if (opts.stockPieces !== 0) await addStock(db, owner, product.id, main.id, opts.stockPieces ?? 400);
  const customer = await createCustomer(db, owner, {
    name: `Customer ${randomUUID().slice(0, 6)}`,
    type: "WHOLESALER",
    creditLimit: opts.creditLimit ?? "100000",
    paymentTermsDays: 14,
  });
  return { owner, sales, product, main, customer };
}

const draftInput = (
  s: { customer: { id: string }; main: { id: string }; product: { id: string } },
  lines: { unit?: string; quantity?: number; discountPercent?: string }[] = [{}],
) => ({
  customerId: s.customer.id,
  warehouseId: s.main.id,
  issueDate: today(),
  lines: lines.map((l) => ({
    productId: s.product.id,
    unit: l.unit ?? "CARTON",
    quantity: l.quantity ?? 1,
    discountPercent: l.discountPercent ?? "",
  })),
});

async function draftInvoice(s: Awaited<ReturnType<typeof setup>>, quantity = 1, unit = "CARTON") {
  const { id } = await createDraft(db, s.owner, "INVOICE", draftInput(s, [{ unit, quantity }]));
  return id;
}

async function setPrice(
  s: { owner: Awaited<ReturnType<typeof makeUser>>; product: { id: string } },
  unit: string,
  price: string,
) {
  await savePrices(db, s.owner, (await getDefaultPriceListId(db))!, [
    { productId: s.product.id, unit, price },
  ]);
}

describe("seed", () => {
  it("creates the three tax rates once and never overwrites an edited rate", async () => {
    const rates = await db.taxRate.findMany({ orderBy: { category: "asc" } });
    expect(rates.map((r) => [r.category, r.rate.toFixed(2)])).toEqual([
      ["STANDARD", "16.00"],
      ["ZERO_RATED", "0.00"],
      ["EXEMPT", "0.00"],
    ]);
    await db.taxRate.update({ where: { category: "STANDARD" }, data: { rate: "14" } });
    const report = await applySeed(db);
    expect(report.taxRatesCreated).toEqual([]);
    expect((await db.taxRate.findUniqueOrThrow({ where: { category: "STANDARD" } })).rate.toFixed(2)).toBe(
      "14.00",
    );
  });
});

describe("drafts and pricing", () => {
  it("prices lines from the price list on the server, with VAT taken out of inclusive prices", async () => {
    const s = await setup();
    const q = await createDraft(db, s.sales, "INVOICE", {
      ...draftInput(s, [
        { unit: "CARTON", quantity: 2 },
        { unit: "PIECE", quantity: 3 },
      ]),
      // Anything the browser says about prices or totals is ignored.
      total: "1.00",
    });
    expect(q.number).toBeNull();
    const doc = await getDocument(db, s.sales, q.id);
    expect(
      doc.lines.map((l) => [l.unit, l.pieces, l.unitPrice, l.netAmount, l.taxAmount, l.grossAmount]),
    ).toEqual([
      ["CARTON", 400, "1900.00", "3275.86", "524.14", "3800.00"],
      ["PIECE", 3, "10.00", "25.86", "4.14", "30.00"],
    ]);
    expect([doc.subtotal, doc.taxTotal, doc.total]).toEqual(["3301.72", "528.28", "3830.00"]);
    expect(doc.pricesIncludeTax).toBe(true);
  });

  it("refuses units without a price and the same product/unit twice", async () => {
    const s = await setup();
    await setPrice(s, "PACK", "");
    const e = await createDraft(db, s.owner, "INVOICE", draftInput(s, [{ unit: "PACK" }])).catch(
      (x: unknown) => x,
    );
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).fieldErrors["lines.0.unit"]?.[0]).toMatch(/no price per pack/);
    const dup = await createDraft(db, s.owner, "INVOICE", draftInput(s, [{}, {}])).catch((x: unknown) => x);
    expect((dup as ValidationError).fieldErrors["lines.1.productId"]?.[0]).toMatch(/Same product and unit/);
  });

  it("only owners and admins give discounts; others may keep an existing one", async () => {
    const s = await setup();
    const e = await createDraft(db, s.sales, "INVOICE", draftInput(s, [{ discountPercent: "5" }])).catch(
      (x: unknown) => x,
    );
    expect((e as ValidationError).fieldErrors["lines.0.discountPercent"]).toBeDefined();

    const { id } = await createDraft(db, s.owner, "INVOICE", draftInput(s, [{ discountPercent: "5" }]));
    const doc = await getDocument(db, s.owner, id);
    expect([doc.lines[0]!.discountAmount, doc.total]).toEqual(["95.00", "1805.00"]);
    // Sales edits the quantity, keeping the owner's 5%: fine. Raising it: refused.
    await updateDraft(db, s.sales, id, {
      ...draftInput(s, [{ quantity: 2, discountPercent: "5" }]),
      version: 1,
    });
    const raised = await updateDraft(db, s.sales, id, {
      ...draftInput(s, [{ quantity: 2, discountPercent: "10" }]),
      version: 2,
    }).catch((x: unknown) => x);
    expect(raised).toBeInstanceOf(ValidationError);
  });

  it("detects two people editing the same draft", async () => {
    const s = await setup();
    const id = await draftInvoice(s);
    await updateDraft(db, s.owner, id, { ...draftInput(s, [{ quantity: 2 }]), version: 1 });
    const stale = await updateDraft(db, s.owner, id, {
      ...draftInput(s, [{ quantity: 3 }]),
      version: 1,
    }).catch((x: unknown) => x);
    expect(stale).toBeInstanceOf(ConflictError);
    expect((await getDocument(db, s.owner, id)).lines[0]!.quantity).toBe(2);
  });

  it("works with prices that exclude VAT", async () => {
    const s = await setup();
    await db.priceList.update({
      where: { id: (await getDefaultPriceListId(db))! },
      data: { pricesIncludeTax: false },
    });
    const id = await draftInvoice(s);
    const doc = await getDocument(db, s.owner, id);
    expect([doc.subtotal, doc.taxTotal, doc.total]).toEqual(["1900.00", "304.00", "2204.00"]);
  });
});

describe("posting invoices", () => {
  it("numbers the invoice only when posted, takes stock out and writes the ledger and audit", async () => {
    const s = await setup();
    const id = await draftInvoice(s, 1);
    expect((await db.salesDocument.findUniqueOrThrow({ where: { id } })).number).toBeNull();

    const res = await postInvoice(db, s.sales, id, { version: 1 });
    expect(res).toEqual({ number: "INV-000001", alreadyPosted: false });
    const doc = await getDocument(db, s.owner, id);
    expect(doc).toMatchObject({ status: "POSTED", issueDay: today() });
    expect(doc.dueDate?.toISOString().slice(0, 10)).toBe(addDays(today(), 14));
    expect((doc.companySnapshot as { name: string }).name).toBeTruthy();
    expect((doc.customerSnapshot as { name: string }).name).toBe(s.customer.name);
    expect(await balance(db, s.product.id, s.main.id)).toBe(200);
    const move = await db.stockMovement.findFirstOrThrow({ where: { type: "SALE" } });
    expect(move).toMatchObject({
      quantity: -200,
      balanceAfter: 200,
      sourceType: "Invoice",
      sourceNumber: "INV-000001",
    });
    expect(await db.auditLog.count({ where: { action: "INVOICE_POSTED" } })).toBe(1);

    // A second click returns the same result and changes nothing.
    expect(await postInvoice(db, s.sales, id, { version: 1 })).toEqual({
      number: "INV-000001",
      alreadyPosted: true,
    });
    expect(await balance(db, s.product.id, s.main.id)).toBe(200);
  });

  it("a failed posting uses no number, so invoice numbers have no gaps", async () => {
    const s = await setup({ stockPieces: 200 });
    const tooBig = await draftInvoice(s, 2);
    const e = await postInvoice(db, s.owner, tooBig, { version: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect((e as Error).message).toMatch(
      /Not enough stock.*has 200 pcs \(1 ctn\), this needs 400 pcs \(2 ctn\)/,
    );
    const ok = await draftInvoice(s, 1);
    expect((await postInvoice(db, s.owner, ok, { version: 1 })).number).toBe("INV-000001");
  });

  it("the database refuses any change to a posted invoice except the amount paid", async () => {
    const s = await setup();
    const id = await draftInvoice(s);
    await postInvoice(db, s.owner, id, { version: 1 });
    await expect(rawQuery(`UPDATE sales_documents SET total = 1 WHERE id = '${id}'`)).rejects.toThrow(
      /cannot be changed/,
    );
    await expect(
      rawQuery(`UPDATE sales_documents SET status = 'CANCELLED', cancelled_at = now() WHERE id = '${id}'`),
    ).rejects.toThrow(/cannot be changed/);
    await expect(rawQuery(`DELETE FROM sales_documents WHERE id = '${id}'`)).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      rawQuery(`UPDATE sales_document_lines SET quantity = 9, pieces = 1800 WHERE document_id = '${id}'`),
    ).rejects.toThrow(/posted invoice/);
    await expect(rawQuery(`DELETE FROM sales_document_lines WHERE document_id = '${id}'`)).rejects.toThrow(
      /posted invoice/,
    );
    await rawQuery(`UPDATE sales_documents SET amount_paid = 100 WHERE id = '${id}'`);
    const cancel = await cancelDocument(db, s.owner, id, { version: 2, reason: "x" }).catch(
      (x: unknown) => x,
    );
    expect((cancel as Error).message).toMatch(/credit note/);
  });

  it("re-prices a draft whose prices changed, and refuses to post until it's been checked", async () => {
    const s = await setup();
    const id = await draftInvoice(s);
    await setPrice(s, "CARTON", "2000");
    const e = await postInvoice(db, s.owner, id, { version: 1 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect((e as Error).message).toMatch(/KES 1,900.00 → KES 2,000.00/);
    const doc = await getDocument(db, s.owner, id);
    expect([doc.status, doc.total, doc.version]).toEqual(["DRAFT", "2000.00", 2]);
    expect((await postInvoice(db, s.owner, id, { version: 2 })).number).toBe("INV-000001");
  });

  it("a tax rate change reaches drafts at posting, but never posted invoices", async () => {
    const s = await setup();
    const posted = await draftInvoice(s);
    await postInvoice(db, s.owner, posted, { version: 1 });
    const draft = await draftInvoice(s);
    await expect(
      updateTaxRate(db, s.sales, { category: "STANDARD", name: "VAT", rate: "14" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await updateTaxRate(db, s.owner, { category: "STANDARD", name: "VAT 14%", rate: "14" });
    await expect(postInvoice(db, s.owner, draft, { version: 1 })).rejects.toThrow(
      /Prices or tax rates changed/,
    );
    expect((await getDocument(db, s.owner, draft)).taxTotal).toBe("233.33");
    expect((await getDocument(db, s.owner, posted)).taxTotal).toBe("262.07");
    expect(await db.auditLog.count({ where: { action: "TAX_RATE_CHANGED" } })).toBe(1);
  });

  it("eight people posting at once can't oversell, and numbers stay in sequence", async () => {
    const s = await setup({ stockPieces: 600 }); // 3 cartons
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(await draftInvoice(s, 1));
    const results = await Promise.allSettled(ids.map((id) => postInvoice(db, s.owner, id, { version: 1 })));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(3);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .every((r) => (r as PromiseRejectedResult).reason instanceof ConflictError),
    ).toBe(true);
    expect(ok.map((r) => (r as PromiseFulfilledResult<{ number: string }>).value.number).sort()).toEqual([
      "INV-000001",
      "INV-000002",
      "INV-000003",
    ]);
    expect(await balance(db, s.product.id, s.main.id)).toBe(0);
  });
});

describe("credit limits", () => {
  it("never stop an invoice: going over the limit is recorded on it and in the audit log", async () => {
    const s = await setup({ creditLimit: "3000" });
    const first = await draftInvoice(s);
    await postInvoice(db, s.sales, first, { version: 1 }); // owes 1,900
    const second = await draftInvoice(s);
    // The draft shows the warning before posting.
    expect((await getDocument(db, s.sales, second)).creditProblem).toMatch(
      /KES 3,800.00 owed, over their credit limit of KES 3,000.00/,
    );
    const res = await postInvoice(db, s.sales, second, { version: 1 });
    expect(res.number).toBe("INV-000002");
    const doc = await db.salesDocument.findUniqueOrThrow({ where: { id: second } });
    expect(doc.creditOverrideById).toBe(s.sales.id);
    expect(doc.creditOverrideReason).toMatch(
      /^Posted over the credit limit\. This takes them to KES 3,800.00/,
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: "INVOICE_POSTED", entityId: second },
    });
    expect(audit.summary).toContain("over the credit limit");
    expect(audit.after).toMatchObject({ overCreditLimit: expect.stringContaining("KES 3,800.00") });
    // Within the limit: nothing recorded.
    const firstDoc = await db.salesDocument.findUniqueOrThrow({ where: { id: first } });
    expect(firstDoc.creditOverrideReason).toBeNull();
  });

  it("a cash-only customer (limit 0) still gets a new invoice while owing, with the warning recorded", async () => {
    const s = await setup({ creditLimit: "0" });
    const first = await draftInvoice(s);
    await postInvoice(db, s.sales, first, { version: 1 });
    const second = await draftInvoice(s);
    expect((await postInvoice(db, s.sales, second, { version: 1 })).number).toBe("INV-000002");
    const doc = await db.salesDocument.findUniqueOrThrow({ where: { id: second } });
    expect(doc.creditOverrideReason).toMatch(/cash-only customer.*owe KES 1,900.00/);
  });
});

describe("documents", () => {
  it("only invoices can be written (quotations and sales orders were removed)", async () => {
    const s = await setup();
    for (const kind of ["QUOTATION", "SALES_ORDER"] as const) {
      await expect(createDraft(db, s.owner, kind, draftInput(s))).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("storekeepers can't create sales documents", async () => {
    const s = await setup();
    const store = await makeUser(db, "STOREKEEPER");
    await expect(createDraft(db, store, "INVOICE", draftInput(s))).rejects.toBeInstanceOf(ForbiddenError);
    const id = await draftInvoice(s);
    await expect(postInvoice(db, store, id, { version: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("share links and PDFs", () => {
  it("share links: random token, only the hash stored, expire and can be revoked", async () => {
    const s = await setup();
    const id = await draftInvoice(s);
    await expect(createShareLink(db, s.owner, id)).rejects.toThrow(/Post the invoice before sharing/);
    await postInvoice(db, s.owner, id, { version: 1 });
    const store = await makeUser(db, "STOREKEEPER");
    await expect(createShareLink(db, store, id)).rejects.toBeInstanceOf(ForbiddenError);

    const { token } = await createShareLink(db, s.sales, id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await db.documentShareLink.findFirstOrThrow({ where: { documentId: id } });
    expect(stored.tokenHash).not.toContain(token);
    expect(await resolveShareToken(db, token)).toBe(id);
    expect(await resolveShareToken(db, `${token.slice(0, -1)}A`)).toBeNull();
    expect(await resolveShareToken(db, "short")).toBeNull();
    expect((await db.documentShareLink.findUniqueOrThrow({ where: { id: stored.id } })).accessCount).toBe(1);

    await revokeShareLink(db, s.sales, stored.id);
    expect(await resolveShareToken(db, token)).toBeNull();

    const second = await createShareLink(db, s.sales, id);
    await db.documentShareLink.updateMany({
      where: { revokedAt: null },
      data: { createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resolveShareToken(db, second.token)).toBeNull();
  });

  it("renders invoice PDFs, with the frozen customer details on posted invoices", async () => {
    const s = await setup();
    const id = await draftInvoice(s);
    const draft = await loadPrintableDocument(db, id);
    expect([draft.number, draft.draft]).toEqual(["DRAFT", true]);
    await postInvoice(db, s.owner, id, { version: 1 });
    await db.customer.update({ where: { id: s.customer.id }, data: { name: "Renamed later" } });
    const printable = await loadPrintableDocument(db, id);
    expect([printable.number, printable.customer.name]).toEqual(["INV-000001", s.customer.name]);
    const bytes = await renderPdf(printable);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
