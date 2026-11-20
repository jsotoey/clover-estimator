import { describe, expect, it } from "vitest";
import { priceEstimate, formatCents, EstimateSchema } from "../src";

const base = { taxRate: 0.06625, paymentProgram: "none" as const, depositPercent: 50 };

describe("priceEstimate", () => {
  it("$1,000 taxable at 6.625%, 50% deposit", () => {
    const r = priceEstimate({ ...base, taxable: true, lineItems: [{ description: "Kitchen cabinets", price: 1000 }] });
    expect(r.subtotalCents).toBe(100000);
    expect(r.taxCents).toBe(6625);
    expect(r.totalCents).toBe(106625);
    expect(r.depositCents).toBe(53313);
    expect(r.balanceCents).toBe(53312);
  });

  it("not taxable means zero tax", () => {
    const r = priceEstimate({ ...base, taxable: false, lineItems: [{ description: "Job", price: 1000 }] });
    expect(r.taxCents).toBe(0);
    expect(r.totalCents).toBe(100000);
    expect(r.depositCents).toBe(50000);
  });

  it("cash discount: card price is base / 0.96, never x 1.04", () => {
    const r = priceEstimate({ ...base, paymentProgram: "cash_discount", taxable: false, lineItems: [{ description: "Job", price: 1000 }] });
    expect(r.lines[0].priceCents).toBe(104167);
    expect(r.lines[0].priceCents).not.toBe(104000);
  });

  it("surcharge leaves estimate prices unchanged", () => {
    const r = priceEstimate({ ...base, paymentProgram: "surcharge", taxable: false, lineItems: [{ description: "Job", price: 1000 }] });
    expect(r.lines[0].priceCents).toBe(100000);
  });

  it("multiple lines sum and keep their exact prices", () => {
    const r = priceEstimate({ ...base, taxable: true, lineItems: [
      { description: "Sand", price: 350 },
      { description: "Paint", price: 650.5 },
    ] });
    expect(r.lines.map((l) => l.priceCents)).toEqual([35000, 65050]);
    expect(r.subtotalCents).toBe(100050);
    expect(r.depositCents + r.balanceCents).toBe(r.totalCents);
  });

  it("rejects a bad tax rate or missing price", () => {
    expect(() => priceEstimate({ ...base, taxRate: 6.625, taxable: true, lineItems: [{ description: "x", price: 1 }] })).toThrow();
    expect(() => priceEstimate({ ...base, taxable: true, lineItems: [{ description: "x", price: 0 }] })).toThrow();
  });

  it("formats cents", () => {
    expect(formatCents(106625)).toBe("$1,066.25");
    expect(formatCents(5)).toBe("$0.05");
  });
});

describe("EstimateSchema", () => {
  const good = {
    customer: { name: "Jennifer", email: "j@example.com" },
    line_items: [{ description: "Kitchen cabinets", price: 1000 }],
    service_date: "2026-11-22",
    completion_date: "2026-11-24",
    deposit_percent: 50,
    deposit_due_date: "2026-11-21",
    expiration_date: "2026-12-19",
    taxable: true,
    delivery: "email",
    note: "Sand and paint kitchen cabinets.",
  };
  it("accepts a complete estimate", () => expect(EstimateSchema.safeParse(good).success).toBe(true));
  it("rejects a note over 200 characters", () =>
    expect(EstimateSchema.safeParse({ ...good, note: "x".repeat(201) }).success).toBe(false));
  it("requires a phone for text delivery", () =>
    expect(EstimateSchema.safeParse({ ...good, delivery: "sms" }).success).toBe(false));
});
