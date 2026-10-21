import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { todayInNairobi, addDays } from "@/lib/dates";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createCustomer } from "@/server/modules/customers/service";
import { postAdjustment, postTransfer } from "@/server/modules/inventory/documents";
import { saveWarehouse } from "@/server/modules/inventory/queries";
import { getDefaultPriceListId, savePrices } from "@/server/modules/pricing/service";
import {
  createDeliveryNote,
  createShareLink,
  dispatchDelivery,
  markDelivered,
  resolveShareToken,
  revokeShareLink,
  updateTaxRate,
} from "@/server/modules/sales/extras";
import { loadPrintableDeliveryNote, loadPrintableDocument, renderPdf } from "@/server/modules/sales/pdf";
import { getDocument } from "@/server/modules/sales/queries";
import {
  cancelDocument,
  confirmOrder,
  convertDocument,
  createDraft,
  postInvoice,
  setQuotationStatus,
  updateDraft,
} from "@/server/modules/sales/service";
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
    const q = await createDraft(db, s.sales, "QUOTATION", {
      ...draftInput(s, [
        { unit: "CARTON", quantity: 2 },
        { unit: "PIECE", quantity: 3 },
      ]),
      validUntil: addDays(today(), 14),
      // Anything the browser says about prices or totals is ignored.
      total: "1.00",
    });
    expect(q.number).toBe("QUO-000001");
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
  it("blocks an invoice that would go over the limit; only owners/admins override, with a reason", async () => {
    const s = await setup({ creditLimit: "3000" });
    const first = await draftInvoice(s);
    await postInvoice(db, s.sales, first, { version: 1 }); // owes 1,900
    const second = await draftInvoice(s);
    const blocked = await postInvoice(db, s.sales, second, { version: 1 }).catch((x: unknown) => x);
    expect(blocked).toBeInstanceOf(ConflictError);
    expect((blocked as Error).message).toMatch(
      /KES 3,800.00 owed, over their credit limit of KES 3,000.00.*Ask an owner/,
    );
    await expect(
      postInvoice(db, s.sales, second, { version: 1, creditOverrideReason: "trust me" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const res = await postInvoice(db, s.owner, second, {
      version: 1,
      creditOverrideReason: "Paid cash on delivery",
    });
    expect(res.number).toBe("INV-000002");
    const doc = await db.salesDocument.findUniqueOrThrow({ where: { id: second } });
    expect([doc.creditOverrideById, doc.creditOverrideReason]).toEqual([s.owner.id, "Paid cash on delivery"]);
  });

  it("a cash-only customer (limit 0) can't take a new invoice while owing on an earlier one", async () => {
    const s = await setup({ creditLimit: "0" });
    const first = await draftInvoice(s);
    await postInvoice(db, s.sales, first, { version: 1 });
    const second = await draftInvoice(s);
    await expect(postInvoice(db, s.sales, second, { version: 1 })).rejects.toThrow(
      /cash-only customer.*owe KES 1,900.00/,
    );
  });
});

describe("quotations and sales orders", () => {
  it("quote → order → invoice keeps the quoted price while the quote is valid", async () => {
    const s = await setup();
    const q = await createDraft(db, s.sales, "QUOTATION", {
      ...draftInput(s),
      validUntil: addDays(today(), 7),
    });
    await setQuotationStatus(db, s.sales, q.id, "SENT", { version: 1 });
    await setQuotationStatus(db, s.sales, q.id, "ACCEPTED", { version: 2 });
    await setPrice(s, "CARTON", "2100");

    const order = await convertDocument(db, s.sales, q.id, "SALES_ORDER");
    expect((await convertDocument(db, s.sales, q.id, "SALES_ORDER")).alreadyConverted).toBe(true);
    expect((await getDocument(db, s.sales, q.id)).status).toBe("CONVERTED");
    const o = await getDocument(db, s.sales, order.id);
    expect([o.number, o.total, o.sourceDocument?.number]).toEqual(["SO-000001", "1900.00", "QUO-000001"]);

    await confirmOrder(db, s.sales, order.id, { version: 1 });
    expect(await db.stockReservation.findMany({ where: { documentId: order.id } })).toMatchObject([
      { quantity: 200 },
    ]);
    const inv = await convertDocument(db, s.sales, order.id, "INVOICE");
    const posted = await postInvoice(db, s.sales, inv.id, { version: 1 });
    expect(posted.number).toBe("INV-000001");
    expect((await getDocument(db, s.sales, inv.id)).total).toBe("1900.00");
    expect((await getDocument(db, s.sales, order.id)).status).toBe("INVOICED");
    expect(await db.stockReservation.count()).toBe(0);
    expect(await balance(db, s.product.id, s.main.id)).toBe(200);
  });

  it("an expired quote converts at today's prices", async () => {
    const s = await setup();
    const q = await createDraft(db, s.sales, "QUOTATION", {
      ...draftInput(s),
      issueDate: addDays(today(), -10),
      validUntil: addDays(today(), -1),
    });
    await setPrice(s, "CARTON", "2100");
    const inv = await convertDocument(db, s.owner, q.id, "INVOICE");
    expect((await getDocument(db, s.owner, inv.id)).total).toBe("2100.00");
  });

  it("confirmed orders hold stock: other invoices and transfers can't take it, cancelling releases it", async () => {
    const s = await setup({ stockPieces: 400 });
    const other = await saveWarehouse(db, s.owner, null, { code: "VAN1", name: "Van 1" });
    const { id: orderId } = await createDraft(db, s.sales, "SALES_ORDER", draftInput(s, [{ quantity: 1 }]));
    await confirmOrder(db, s.sales, orderId, { version: 1 });
    // Same click twice: one reservation.
    expect(await confirmOrder(db, s.sales, orderId, { version: 1 })).toEqual({ alreadyConfirmed: true });
    expect(await db.stockReservation.count()).toBe(1);

    const second = await createDraft(db, s.sales, "SALES_ORDER", draftInput(s, [{ quantity: 2 }]));
    await expect(confirmOrder(db, s.sales, second.id, { version: 1 })).rejects.toThrow(
      /Not enough stock to reserve.*400 pcs \(2 ctn\) of which 200 pcs \(1 ctn\) is reserved/,
    );
    const inv = await draftInvoice(s, 2);
    await expect(postInvoice(db, s.owner, inv, { version: 1 })).rejects.toThrow(
      /reserved for confirmed orders/,
    );
    await expect(
      postTransfer(db, s.owner, {
        fromWarehouseId: s.main.id,
        toWarehouseId: (other as { id: string }).id,
        idempotencyKey: randomUUID(),
        lines: [{ productId: s.product.id, unit: "CARTON", quantity: 2 }],
      }),
    ).rejects.toThrow(/reserved/);
    // A write-off records what physically happened, so it isn't blocked by reservations.
    await postAdjustment(db, s.owner, {
      warehouseId: s.main.id,
      reason: "DAMAGED",
      idempotencyKey: randomUUID(),
      lines: [{ productId: s.product.id, direction: "OUT", unit: "PACK", quantity: 1 }],
    });

    await cancelDocument(db, s.sales, orderId, { version: 2, reason: "Customer changed their mind" });
    expect(await db.stockReservation.count()).toBe(0);
    expect((await getDocument(db, s.sales, orderId)).cancelReason).toBe("Customer changed their mind");
  });

  it("can't cancel an order that has a draft invoice, or invoice an unconfirmed order", async () => {
    const s = await setup();
    const { id } = await createDraft(db, s.sales, "SALES_ORDER", draftInput(s));
    await expect(convertDocument(db, s.sales, id, "INVOICE")).rejects.toThrow(/Confirm SO-000001 first/);
    await confirmOrder(db, s.sales, id, { version: 1 });
    await convertDocument(db, s.sales, id, "INVOICE");
    await expect(cancelDocument(db, s.sales, id, { version: 2, reason: "x" })).rejects.toThrow(
      /Cancel that draft first/,
    );
  });

  it("storekeepers can't create sales documents", async () => {
    const s = await setup();
    const store = await makeUser(db, "STOREKEEPER");
    await expect(createDraft(db, store, "INVOICE", draftInput(s))).rejects.toBeInstanceOf(ForbiddenError);
    const id = await draftInvoice(s);
    await expect(postInvoice(db, store, id, { version: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("delivery notes, share links and PDFs", () => {
  it("delivery note: one per posted invoice, prepared → dispatched → delivered", async () => {
    const s = await setup();
    const id = await draftInvoice(s);
    await expect(createDeliveryNote(db, s.owner, id)).rejects.toThrow(/Post the invoice/);
    await postInvoice(db, s.owner, id, { version: 1 });
    const store = await makeUser(db, "STOREKEEPER");
    const note = await createDeliveryNote(db, store, id);
    expect(note.number).toBe("DN-000001");
    expect((await createDeliveryNote(db, store, id)).id).toBe(note.id);
    await dispatchDelivery(db, store, note.id, { version: 1, vehicle: "KDA 123A", driver: "Otieno" });
    await expect(markDelivered(db, store, note.id, { version: 2, receivedBy: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await markDelivered(db, store, note.id, { version: 2, receivedBy: "Mama Pima" });
    const row = await db.deliveryNote.findUniqueOrThrow({ where: { id: note.id } });
    expect([row.status, row.vehicle, row.receivedBy]).toEqual(["DELIVERED", "KDA 123A", "Mama Pima"]);
    const pdf = await renderPdf(await loadPrintableDeliveryNote(db, note.id));
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });

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

  it("renders invoice and quotation PDFs, with the frozen customer details on posted invoices", async () => {
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
