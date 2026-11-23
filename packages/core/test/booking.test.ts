import { describe, expect, it } from "vitest";
import { bookingSettings, checkBookingRequest, isOpen, openSlots, visitNote, zonedInstant, zonedClock } from "../src/booking";

const leal = bookingSettings({
  enabled: true, service: "Free Measure & Estimate", employee: "Estimator",
  minutes: 30, bufferMinutes: 45, noticeHours: 24, maxDays: 14, stepMinutes: 15,
  hours: { mon: ["08:00", "12:00"], tue: ["08:00", "12:00"], wed: ["08:00", "12:00"], thu: ["08:00", "12:00"], fri: ["08:00", "12:00"], sat: ["09:00", "12:00"] },
});
// Mon Nov 23 2026, 10:49 AM New York (EST = UTC-5)
const now = Date.parse("2026-11-23T15:49:00Z");

describe("time zone helpers", () => {
  it("converts New York wall time to UTC, across daylight saving", () => {
    expect(new Date(zonedInstant("2026-11-24", "08:00", "America/New_York")).toISOString()).toBe("2026-11-24T13:00:00.000Z");
    expect(new Date(zonedInstant("2026-07-01", "08:00", "America/New_York")).toISOString()).toBe("2026-07-01T12:00:00.000Z");
    expect(zonedClock(Date.parse("2026-11-24T14:15:00Z"), "America/New_York")).toBe("9:15 AM");
  });
});

describe("open slots", () => {
  const days = openSlots(leal, now, []);
  it("covers 14 days starting tomorrow", () => {
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe("2026-11-24");
    expect(days[13].date).toBe("2026-12-07");
  });
  it("needs 24 hours notice: tomorrow starts at 11:00, not earlier", () => {
    expect(days[0].slots.map((s) => s.label)).toEqual(["11:00 AM", "11:15 AM", "11:30 AM"]);
  });
  it("mornings only; the visit must end by noon", () => {
    const wed = days[1];
    expect(wed.slots[0].label).toBe("8:00 AM");
    expect(wed.slots.at(-1)!.label).toBe("11:30 AM");
  });
  it("Saturday 9 to 12, Sunday closed", () => {
    const sat = days.find((d) => d.weekday === "sat")!;
    expect(sat.slots[0].label).toBe("9:00 AM");
    expect(days.find((d) => d.weekday === "sun")!.slots).toEqual([]);
  });
  it("blocks the visit plus 45 minutes of drive time on both sides", () => {
    const booked = { start: zonedInstant("2026-11-25", "09:00", leal.timeZone), minutes: 30, bufferMinutes: 45 };
    const wed = openSlots(leal, now, [booked])[1].slots.map((s) => s.label);
    // 8:00 ends 8:30 + 45 = 9:15 > 9:00, so 8:00 clashes; anything before 10:15 clashes after.
    expect(wed).toEqual(["10:15 AM", "10:30 AM", "10:45 AM", "11:00 AM", "11:15 AM", "11:30 AM"]);
  });
  it("isOpen rejects a taken or made-up time", () => {
    const start = new Date(zonedInstant("2026-11-25", "10:15", leal.timeZone)).toISOString();
    expect(isOpen(leal, now, [], start)).toBe(true);
    expect(isOpen(leal, now, [{ start: Date.parse(start), minutes: 30, bufferMinutes: 45 }], start)).toBe(false);
    expect(isOpen(leal, now, [], "2026-11-25T15:07:00.000Z")).toBe(false);
  });
});

describe("settings", () => {
  it("falls back to safe defaults and drops bad hours", () => {
    const s = bookingSettings({ minutes: -5, hours: { mon: ["12:00", "08:00"], tue: ["08:00", "12:00"] } });
    expect(s.enabled).toBe(false);
    expect(s.minutes).toBe(15);
    expect(s.hours).toEqual({ tue: ["08:00", "12:00"] });
  });
});

describe("booking request", () => {
  const good = {
    firstName: "Test", lastName: "Soto", email: "jon@example.com", phone: "(917) 328-3255",
    street: "12 Main St", city: "Union", zip: "07083", projectType: "Mirror", details: "Bathroom mirror 36x48", start: "2026-11-25T15:15:00.000Z",
  };
  it("accepts a complete request", () => expect(checkBookingRequest(good)).toEqual([]));
  it("lists what's missing in plain English", () => {
    expect(checkBookingRequest({ ...good, zip: "7083", phone: "555" })).toEqual(["Add a 10-digit phone number.", "Add a 5-digit ZIP code."]);
  });
  it("note for Clover keeps the address and stays under 250 characters", () => {
    const n = visitNote({ ...good, details: "x".repeat(600) }, 2);
    expect(n.startsWith("ADDRESS: 12 Main St, Union, 07083. PHONE: (917) 328-3255. Mirror (2 photos in app): ")).toBe(true);
    expect(n.length).toBeLessThanOrEqual(250);
  });
});
