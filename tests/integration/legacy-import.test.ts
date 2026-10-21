import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { applyLegacyPlan } from "@/server/modules/legacy/apply";
import { buildLegacyPlan, type LegacyRows } from "@/server/modules/legacy/plan";
import { renderReport } from "@/server/modules/legacy/report";
import { postInvoice } from "@/server/modules/sales/service";
import { applySeed } from "@/server/seed";

import { clearTestData, rawQuery } from "./db";
import { makeUser, testDb } from "./helpers";

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await clearTestData();
  await applySeed(db);
});

// A small made-up export in the old system's format (names from the merge list, not real figures).
function files(): LegacyRows {
  return {
    "products-inventory": [
      {
        sku: "WRG-010",
        name: "Big G",
        category: "Chewing Gum",
        pack_size: "50",
        units_per_case: "30",
        unit_price: "170",
        wholesale_price: "165",
        reorder_level: "10",
      },
      {
        sku: "WRG-011",
        name: "Juicy Fruit 50`s",
        category: "Juicy Fruit",
        pack_size: "50",
        units_per_case: "36",
        unit_price: "370",
        wholesale_price: "360",
        reorder_level: "10",
      },
    ],
    customers: [
      { name: "Abdi Wholesalers ", phone: "0700" },
      { name: "Abdi wholesalers", phone: "0700" },
      { name: "Martin Carni ", phone: "0725821352" },
      { name: "Nakumatt Supermarket", phone: "0720123456" },
    ],
    invoices: [
      {
        invoice_number: "VJL-AAA",
        date: "2026-07-08T21:30:00.000000",
        customer_name: "Abdi wholesalers",
        total_amount: "4800",
        amount_paid: "4800",
        balance: "0",
        created_by_name: "Reuben Maina",
      },
      {
        // VAT added on top in the old system: corrected to the line total
        invoice_number: "VJL-MTY15V4S-A2A",
        date: "2026-10-05T12:13:51.599000",
        customer_name: "Abdi Wholesalers ",
        total_amount: "5742",
        amount_paid: "0",
        balance: "5742",
      },
      {
        invoice_number: "VJL-BBB",
        date: "2026-09-01T10:00:00.000000",
        customer_name: "Martin Carni",
        total_amount: "12960",
        amount_paid: "20000",
        balance: "0",
      },
    ],
    "invoice-line-items": [
      { invoice_number: "VJL-AAA", sku: "WRG-010", quantity: "30", unit_price: "165", line_total: "4950" },
      { invoice_number: "VJL-AAA", sku: "WRG-011", quantity: "0", unit_price: "360", line_total: "0" },
      {
        invoice_number: "VJL-MTY15V4S-A2A",
        sku: "WRG-010",
        quantity: "30",
        unit_price: "165",
        line_total: "4950",
      },
      { invoice_number: "VJL-BBB", sku: "WRG-011", quantity: "36", unit_price: "360", line_total: "12960" },
    ],
    payments: [{ invoice_number: "VJL-GONE", amount: "1700" }],
  };
}

describe("old system import", () => {
  it("plans merges, corrections and discounts, and reports every problem", () => {
    const plan = buildLegacyPlan(files());
    expect(plan.problems.filter((p) => p.level === "error")).toEqual([]);
    const abdi = plan.customers.find((c) => c.name === "Abdi Wholesalers")!;
    expect([abdi.invoices, abdi.outstanding, abdi.phone]).toEqual([2, "4950.00", null]);
    expect(plan.customers.find((c) => c.name === "Martin Carni")!.phone).toBe("254725821352");
    expect(plan.customers.some((c) => /Nakumatt/.test(c.name))).toBe(false);

    const aaa = plan.invoices.find((i) => i.number === "VJL-AAA")!;
    expect(aaa.lines).toHaveLength(1); // the empty line is dropped
    expect([aaa.total, aaa.discountTotal, aaa.taxTotal, aaa.issueDay]).toEqual([
      "4800.00",
      "150.00",
      "662.07",
      "2026-07-09", // 21:30 UTC is the next morning in Nairobi
    ]);
    const a2a = plan.invoices.find((i) => i.number === "VJL-MTY15V4S-A2A")!;
    expect([a2a.total, a2a.correction !== null]).toEqual(["4950.00", true]);
    const bbb = plan.invoices.find((i) => i.number === "VJL-BBB")!;
    expect(bbb.amountPaid).toBe("12960.00"); // capped at the total, with a warning
    expect(plan.problems.map((p) => p.message).join("\n")).toMatch(/KES 20,000.00 paid on a KES 12,960.00/);
    expect(plan.problems.map((p) => p.message).join("\n")).toMatch(/VJL-GONE/);
    expect(renderReport(plan)).toContain("| Outstanding |");
  });

  it("an unknown customer name stops the import", () => {
    const f = files();
    f.invoices![0]!.customer_name = "Someone New";
    const plan = buildLegacyPlan(f);
    expect(plan.problems.some((p) => p.level === "error" && /Someone New/.test(p.message))).toBe(true);
  });

  it("imports read-only historical invoices without moving stock, and running it again changes nothing", async () => {
    const owner = await makeUser(db, "OWNER");
    const plan = buildLegacyPlan(files());
    const first = await applyLegacyPlan(db, owner, plan);
    expect(first).toMatchObject({ productsCreated: 2, customersCreated: 2, invoicesCreated: 3 });
    const again = await applyLegacyPlan(db, owner, plan);
    expect(again).toMatchObject({
      productsCreated: 0,
      customersMatched: 2,
      invoicesCreated: 0,
      invoicesAlreadyThere: 3,
    });

    const inv = await db.salesDocument.findUniqueOrThrow({
      where: { number: "VJL-AAA" },
      include: { lines: true },
    });
    expect([inv.status, inv.historical, inv.total.toFixed(2), inv.amountPaid.toFixed(2)]).toEqual([
      "POSTED",
      true,
      "4800.00",
      "4800.00",
    ]);
    expect(inv.lines[0]).toMatchObject({ unit: "PACK", quantity: 30, pieces: 1500 });
    expect(await db.stockMovement.count()).toBe(0);
    await expect(rawQuery(`UPDATE sales_documents SET total = 1 WHERE number = 'VJL-AAA'`)).rejects.toThrow(
      /cannot be changed/,
    );

    const abdi = await db.customer.findFirstOrThrow({ where: { name: "Abdi Wholesalers" } });
    expect(abdi.legacyNames).toContain("Abdi wholesalers");
    expect(abdi.priceListId).not.toBeNull(); // wholesalers get the wholesale list
    const wholesale = await db.priceList.findUniqueOrThrow({ where: { code: "WHOLESALE" } });
    expect(
      (await db.priceListItem.findMany({ where: { priceListId: wholesale.id } }))
        .map((i) => i.price.toFixed(2))
        .sort(),
    ).toEqual(["12960.00", "165.00", "360.00", "4950.00"]);

    // Old debts count: Abdi (cash only) still owes 4,950, so a new invoice needs an override.
    const draft = await db.salesDocument.create({
      data: {
        kind: "INVOICE",
        customerId: abdi.id,
        warehouseId: (await db.warehouse.findFirstOrThrow()).id,
        issueDate: new Date(),
        createdById: owner.id,
      },
    });
    await db.salesDocumentLine.create({
      data: {
        documentId: draft.id,
        position: 1,
        productId: inv.lines[0]!.productId,
        sku: "WRG-010",
        description: "Big G",
        unit: "PACK",
        quantity: 1,
        piecesPerUnit: 50,
        pieces: 50,
        unitPrice: "165",
        taxCategory: "STANDARD",
        taxRate: "16",
        netAmount: "142.24",
        taxAmount: "22.76",
        grossAmount: "165.00",
      },
    });
    await expect(postInvoice(db, owner, draft.id, { version: 1 })).rejects.toThrow(
      /cash-only customer.*KES 4,950.00/,
    );
  });
});

describe("opening stock from the inventory report", () => {
  it("posts one opening-balance adjustment in packets, once", async () => {
    const owner = await makeUser(db, "OWNER");
    const f = files();
    f["inventory-report"] = [
      { sku: "WRG-010", pack_size: "50", units_per_case: "30", cases: "8", loose: "15", total_units: "255" },
      { sku: "WRG-011", pack_size: "50", units_per_case: "36", cases: "0", loose: "0", total_units: "0" },
    ];
    const plan = buildLegacyPlan(f);
    expect(plan.openingStock).toEqual([{ sku: "WRG-010", packs: 255, pieces: 12750, cartons: 8, loose: 15 }]);
    expect((await applyLegacyPlan(db, owner, plan)).stockSet).toBe(1);
    expect((await applyLegacyPlan(db, owner, plan)).stockSet).toBe(0);
    const big = await db.product.findUniqueOrThrow({ where: { sku: "WRG-010" } });
    const bal = await db.stockBalance.findFirstOrThrow({ where: { productId: big.id } });
    expect(bal.quantity).toBe(12750);
    const adj = await db.stockAdjustment.findMany({ include: { lines: true } });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ reason: "OPENING_BALANCE" });
    expect(adj[0]!.lines[0]).toMatchObject({ unit: "PACK", unitQuantity: 255, quantity: 12750 });
  });
});
