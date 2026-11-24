import { describe, expect, it } from "vitest";
import { stage, initials } from "../lib/stage";

const base = { status: "sent", error: null, acceptedAt: null as string | null, invoices: [] as { kind: string; status: string }[], install: null as string | null };

describe("estimate stage", () => {
  it("waiting for a yes", () => {
    expect(stage(base)).toMatchObject({ done: 1, tag: "Waiting", group: "waiting" });
  });
  it("accepted with no deposit yet asks for the deposit", () => {
    expect(stage({ ...base, acceptedAt: "x" })).toMatchObject({ done: 2, next: "Send the deposit invoice", group: "needs" });
  });
  it("deposit paid, install being booked, then booked (no stale 'Install next')", () => {
    const paid = { ...base, acceptedAt: "x", invoices: [{ kind: "deposit", status: "paid_in_person" }] };
    expect(stage({ ...paid, install: "to_book" }).next).toBe("Booking the install in Clover");
    expect(stage({ ...paid, install: "tentative" })).toMatchObject({ done: 4, next: "Send the balance after the install" });
  });
  it("paid in full fills the bar", () => {
    const s = stage({ ...base, acceptedAt: "x", install: "confirmed", invoices: [{ kind: "deposit", status: "paid" }, { kind: "balance", status: "paid_in_person" }] });
    expect(s).toMatchObject({ done: 5, group: "paid" });
  });
  it("failures need you", () => {
    expect(stage({ ...base, status: "failed" }).group).toBe("needs");
    expect(stage({ ...base, acceptedAt: "x", install: "failed", invoices: [{ kind: "deposit", status: "paid" }] }).tone).toBe("bad");
  });
  it("initials skip the TEST prefix", () => {
    expect(initials("TEST Jon Soto")).toBe("JS");
    expect(initials(null)).toBe("?");
  });
});
