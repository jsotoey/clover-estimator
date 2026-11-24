import { describe, expect, it } from "vitest";
import { handleSubmitEstimate } from "../lib/estimateTool";

const settings = { taxRate: 0.06625, paymentProgram: "cash_discount" as const };
const input = {
  customer: { name: "Test Customer", email: "j@example.com" },
  line_items: [{ description: "Cabinet sanding & painting", price: 1000 }],
  service_date: "2026-11-21",
  completion_date: "2026-11-21",
  deposit_percent: 50,
  deposit_due_date: "2026-11-19",
  expiration_date: "2026-11-20",
  taxable: true,
  delivery: "email",
  note: "Cabinet sanding & painting.",
};

describe("handleSubmitEstimate", () => {
  it("matches a real cash-discount estimate: $1,000 cash price -> $1,110.68", () => {
    const r = handleSubmitEstimate(input, settings);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.computed.lines[0].priceCents).toBe(104167);
    expect(r.computed.taxCents).toBe(6901);
    expect(r.computed.totalCents).toBe(111068);
  });
  it("returns a fix-it message instead of throwing on bad input", () => {
    const r = handleSubmitEstimate({ ...input, delivery: "sms" }, settings);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/phone/i);
  });
});
