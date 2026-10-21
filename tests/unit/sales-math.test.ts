import { describe, expect, it } from "vitest";

import { addDays, fromDbDate, toDbDate, todayInNairobi } from "@/lib/dates";
import { calculateLine, formatRate, sumLines, taxBreakdown } from "@/lib/sales-math";

describe("line calculations", () => {
  it("takes 16% VAT out of a VAT-inclusive price", () => {
    // The old system's Abdi invoice: 68,540 already included VAT.
    expect(calculateLine({ quantity: 1, unitPrice: "68540", taxRate: "16" }, true)).toEqual({
      listAmount: "68540.00",
      discountAmount: "0.00",
      netAmount: "59086.21",
      taxAmount: "9453.79",
      grossAmount: "68540.00",
    });
  });

  it("adds VAT on top of a VAT-exclusive price", () => {
    expect(calculateLine({ quantity: 3, unitPrice: "1000", taxRate: "16" }, false)).toMatchObject({
      netAmount: "3000.00",
      taxAmount: "480.00",
      grossAmount: "3480.00",
    });
  });

  it("applies the discount before tax and rounds each line half-up to the cent", () => {
    const l = calculateLine({ quantity: 7, unitPrice: "33.33", discountPercent: "2.5", taxRate: "16" }, true);
    // 7 × 33.33 = 233.31; 2.5% = 5.83275 → 5.83; 227.48 gross; VAT 31.3765… → 31.38
    expect(l).toEqual({
      listAmount: "233.31",
      discountAmount: "5.83",
      netAmount: "196.10",
      taxAmount: "31.38",
      grossAmount: "227.48",
    });
  });

  it("zero-rated and exempt lines carry no VAT; 100% discount gives zero", () => {
    expect(calculateLine({ quantity: 2, unitPrice: "50", taxRate: "0" }, true)).toMatchObject({
      netAmount: "100.00",
      taxAmount: "0.00",
    });
    expect(
      calculateLine({ quantity: 2, unitPrice: "50", discountPercent: "100", taxRate: "16" }, true),
    ).toMatchObject({
      grossAmount: "0.00",
      taxAmount: "0.00",
    });
  });

  it("never gives net + VAT different from the gross, across many prices", () => {
    for (let cents = 1; cents < 5000; cents += 37) {
      for (const inclusive of [true, false]) {
        const l = calculateLine(
          { quantity: 3, unitPrice: (cents / 100).toFixed(2), taxRate: "16" },
          inclusive,
        );
        expect((Number(l.netAmount) * 100 + Number(l.taxAmount) * 100).toFixed(0)).toBe(
          (Number(l.grossAmount) * 100).toFixed(0),
        );
      }
    }
  });

  it("rejects bad input instead of guessing", () => {
    expect(() => calculateLine({ quantity: 1.5, unitPrice: "1", taxRate: "16" }, true)).toThrow(
      /whole number/,
    );
    expect(() => calculateLine({ quantity: 0, unitPrice: "1", taxRate: "16" }, true)).toThrow();
    expect(() => calculateLine({ quantity: 1, unitPrice: "-1", taxRate: "16" }, true)).toThrow(/negative/);
    expect(() =>
      calculateLine({ quantity: 1, unitPrice: "1", discountPercent: "101", taxRate: "16" }, true),
    ).toThrow(/Discount/);
  });
});

describe("document totals", () => {
  it("sums the rounded lines and summarises VAT per rate", () => {
    const a = {
      ...calculateLine({ quantity: 2, unitPrice: "1900", taxRate: "16" }, true),
      taxRate: "16.0000",
    };
    const b = { ...calculateLine({ quantity: 3, unitPrice: "10", taxRate: "16" }, true), taxRate: "16.0000" };
    const c = { ...calculateLine({ quantity: 1, unitPrice: "250", taxRate: "0" }, true), taxRate: "0.0000" };
    expect(sumLines([a, b, c])).toEqual({
      subtotal: "3551.72",
      discountTotal: "0.00",
      taxTotal: "528.28",
      total: "4080.00",
    });
    expect(taxBreakdown([a, b, c])).toEqual([
      { rate: "16.00", net: "3301.72", tax: "528.28" },
      { rate: "0.00", net: "250.00", tax: "0.00" },
    ]);
    expect(formatRate("16.0000")).toBe("16%");
    expect(formatRate("8.5000")).toBe("8.5%");
  });
});

describe("dates", () => {
  it("uses the Nairobi calendar day, not UTC", () => {
    // 22:30 UTC on 21 Oct is 01:30 on 22 Oct in Nairobi.
    expect(todayInNairobi(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(fromDbDate(toDbDate("2026-02-28"))).toBe("2026-02-28");
    expect(() => toDbDate("28/02/2026")).toThrow();
  });
});
