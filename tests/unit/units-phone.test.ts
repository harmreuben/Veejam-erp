import { describe, expect, it } from "vitest";

import { formatKenyanPhone, normalizeKenyanPhone } from "@/lib/phone";
import { breakdown, formatQuantity, piecesPerUnit, toPieces } from "@/lib/units";

// Illustrative pack sizes only; real sizes come from each product record.
const sizes = { unitsPerPack: 10, packsPerCarton: 20 };

describe("unit conversions", () => {
  it("converts pieces, packs and cartons to pieces", () => {
    expect(toPieces(7, "PIECE", sizes)).toBe(7);
    expect(toPieces(3, "PACK", sizes)).toBe(30);
    expect(toPieces(2, "CARTON", sizes)).toBe(400);
    expect(piecesPerUnit("CARTON", sizes)).toBe(200);
  });

  it("rejects fractions instead of rounding them", () => {
    expect(() => toPieces(1.5, "CARTON", sizes)).toThrow(/whole number of cartons/);
  });

  it("rejects absurd quantities and bad pack sizes", () => {
    expect(() => toPieces(10_000_000, "CARTON", sizes)).toThrow(/too large/);
    expect(() => toPieces(1, "PACK", { unitsPerPack: 0, packsPerCarton: 5 })).toThrow();
    expect(() => toPieces(1, "PACK", { unitsPerPack: 2.5, packsPerCarton: 5 })).toThrow();
  });

  it("breaks pieces down into cartons, packs and loose pieces", () => {
    expect(breakdown(437, sizes)).toEqual({ cartons: 2, packs: 3, pieces: 7 });
    expect(breakdown(-437, sizes)).toEqual({ cartons: -2, packs: -3, pieces: -7 });
    expect(breakdown(0, sizes)).toEqual({ cartons: 0, packs: 0, pieces: 0 });
  });

  it("formats quantities for people", () => {
    expect(formatQuantity(437, sizes)).toBe("437 pcs (2 ctn, 3 pk, 7 pcs)");
    expect(formatQuantity(400, sizes)).toBe("400 pcs (2 ctn)");
    expect(formatQuantity(9, sizes)).toBe("9 pcs");
    expect(formatQuantity(12_000, sizes)).toBe("12,000 pcs (60 ctn)");
  });
});

describe("Kenyan phone numbers", () => {
  it.each([
    ["0712345678", "254712345678"],
    ["0712 345 678", "254712345678"],
    ["+254 712-345-678", "254712345678"],
    ["254112345678", "254112345678"],
    ["0112345678", "254112345678"],
    ["712345678", "254712345678"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(["0700", "07", "07000", "0700000000", "0711111111", "0812345678", "abc", "", "+1 555 123 4567"])(
    "rejects %s",
    (input) => {
      expect(normalizeKenyanPhone(input)).toBeNull();
    },
  );

  it("formats for display", () => {
    expect(formatKenyanPhone("254712345678")).toBe("0712 345 678");
    expect(formatKenyanPhone(null)).toBe("");
  });
});
