import { describe, expect, it } from "vitest";
import { buildReport, facts, lastFullWeek, pctChange, weekStats } from "../src/metrics";
import { numbersCheckOut, templateDraft } from "../src/write";
import { sampleOrders } from "../src/sample";
import type { Order } from "../src/types";

const TZ = "America/New_York";
const at = (iso: string, cents: number, name = "Roti", extra: Partial<Order> = {}): Order =>
  ({ id: iso, createdAt: new Date(iso), totalCents: cents, tipCents: 0, refundCents: 0, lines: [{ name, qty: 1, cents }], ...extra });

describe("weeks", () => {
  it("last full week is Mon–Sun in the merchant's time zone", () => {
    // Monday Nov 23 2026, 3am UTC = Sunday 10pm in New York, so the last FULL week is Nov 9–15
    expect(lastFullWeek(new Date("2026-11-23T03:00:00Z"), TZ)).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(lastFullWeek(new Date("2026-11-23T15:00:00Z"), TZ)).toEqual({ start: "2026-11-16", end: "2026-11-22" });
  });
  it("counts orders by local date and nets out refunds", () => {
    const s = weekStats([
      at("2026-11-16T04:30:00Z", 1000),             // Sun Nov 15 11:30pm local: previous week
      at("2026-11-16T15:00:00Z", 2000),             // Mon Nov 16
      at("2026-11-22T20:00:00Z", 3000, "Roti", { refundCents: 3000, tipCents: 500 }), // Sun, refunded
    ], "2026-11-16", TZ);
    expect(s.orders).toBe(2);
    expect(s.salesCents).toBe(2000);
    expect(s.refundsCents).toBe(3000);
    expect(s.items.get("Roti")?.qty).toBe(1); // refunded order's items not counted
    expect(s.byDay[0]).toBe(2000);
  });
  it("pctChange rounds and handles zero", () => {
    expect(pctChange(115, 100)).toBe(15);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("report on sample data", () => {
  const now = new Date("2026-11-23T15:00:00Z");
  const r = buildReport(sampleOrders(now, 6), now, TZ);
  it("finds the trends planted in the sample", () => {
    expect(r.week.orders).toBeGreaterThan(100);
    expect(r.risers.map((x) => x.name)).toContain("Oxtail Plate");
    expect(r.weeksOfHistory).toBe(4);
  });
  it("template draft only uses numbers from the facts", () => {
    const f = facts(r);
    const d = templateDraft({ id: "x", name: "Sample", contactName: "Sam", email: "a@b.c", timezone: TZ }, r);
    expect(numbersCheckOut(d, f)).toEqual({ ok: true, bad: [] });
  });
  it("catches an invented number", () => {
    const f = facts(r);
    const d = { ...templateDraft({ id: "x", name: "Sample", contactName: "Sam", email: "a@b.c", timezone: TZ }, r), idea: "Sales could grow 37% if you add delivery." };
    expect(numbersCheckOut(d, f).ok).toBe(false);
  });
});
