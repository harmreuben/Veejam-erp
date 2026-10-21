import { describe, expect, it } from "vitest";

import { formatKES, lineAmount, percentOf, roundMoney, sumMoney, toDecimal } from "@/lib/money";

describe("money helpers", () => {
  it("avoids floating point errors", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the problem
    expect(sumMoney(["0.1", "0.2"]).toFixed(2)).toBe("0.30"); // the fix
  });

  it("rounds half up to cents", () => {
    expect(roundMoney("10.005").toFixed(2)).toBe("10.01");
    expect(roundMoney("10.004").toFixed(2)).toBe("10.00");
    expect(roundMoney("-10.005").toFixed(2)).toBe("-10.01");
  });

  it("calculates line amounts", () => {
    expect(lineAmount(3, "19.99").toFixed(2)).toBe("59.97");
    expect(lineAmount("2.5", "33.33").toFixed(2)).toBe("83.33");
  });

  it("calculates percentages without assuming a tax rate", () => {
    expect(percentOf("1000", "10").toFixed(2)).toBe("100.00");
    expect(percentOf("99.99", "12.5").toFixed(2)).toBe("12.50");
  });

  it("sums many small amounts exactly", () => {
    const hundredTimes = Array.from({ length: 100 }, () => "0.01");
    expect(sumMoney(hundredTimes).toFixed(2)).toBe("1.00");
  });

  it("rejects invalid numbers", () => {
    expect(() => toDecimal(Number.NaN)).toThrow(RangeError);
    expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toDecimal("abc")).toThrow();
  });

  it("formats KES for display", () => {
    expect(formatKES("1234567.5")).toBe("KES 1,234,567.50");
    expect(formatKES(0)).toBe("KES 0.00");
    expect(formatKES("-250")).toBe("-KES 250.00");
  });
});
