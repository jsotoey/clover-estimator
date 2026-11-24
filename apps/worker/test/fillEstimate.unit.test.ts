import { describe, expect, it } from "vitest";
import { parseMoneyToCents, taxLabelPattern, toUSDate } from "../src/clover/fillEstimate";

describe("fillEstimate helpers", () => {
  it("parses Clover money", () => {
    expect(parseMoneyToCents("$1,110.68")).toBe(111068);
    expect(parseMoneyToCents("$0.05")).toBe(5);
    expect(parseMoneyToCents("-$3.00")).toBe(-300);
    expect(parseMoneyToCents("n/a")).toBeNull();
  });
  it("matches NJ tax labels as Clover shows them", () => {
    expect(taxLabelPattern(0.06625).test("NJ Sales Tax (6.63%)")).toBe(true);
    expect(taxLabelPattern(0.06625).test("NJ Sales Tax (6.625%)")).toBe(true);
    expect(taxLabelPattern(0.06625).test("NY Tax (8.875%)")).toBe(false);
  });
  it("formats US dates", () => expect(toUSDate("2026-11-21")).toBe("11/21/2026"));
});
