import { describe, expect, it } from "vitest";
import { bookingSettings, customerConfirmation, shopNotice, visitIcs } from "../src";

const s = bookingSettings({ enabled: true, minutes: 30, phone: "(908) 527-8860", notifyEmail: "shop@example.com" });
const b = {
  firstName: "Jon", lastName: "Soto", email: "jon@example.com", phone: "917-328-3255",
  street: "130 North Avenue", city: "Hillside", zip: "07205", projectType: "Mirror",
  details: "Bathroom mirror <36x48>\nwith lights", start: "2026-11-26T13:15:00.000Z",
};

describe("booking emails", () => {
  it("customer confirmation has the date, time, address, change line and a calendar file", () => {
    const e = customerConfirmation({ id: "abc", storeName: "Leal Glass & Mirror", s, b, now: Date.parse("2026-11-23T16:00:00Z") });
    expect(e.to).toBe("jon@example.com");
    expect(e.replyTo).toBe("shop@example.com");
    expect(e.subject).toBe("You're booked: November 26 at 8:15 AM with Leal Glass & Mirror");
    expect(e.text).toContain("When: Thursday, November 26 at 8:15 AM (about 30 minutes)");
    expect(e.text).toContain("Where: 130 North Avenue, Hillside 07205");
    expect(e.text).toContain("Call or text (908) 527-8860");
    expect(e.html).toContain("Leal Glass &amp; Mirror");
    const ics = atob(e.attachments![0].Content);
    expect(ics).toContain("DTSTART:20261126T131500Z");
    expect(ics).toContain("DTEND:20261126T134500Z");
    expect(ics).toContain("LOCATION:130 North Avenue\\, Hillside 07205");
  });
  it("shop notice escapes the customer's text and links the app", () => {
    const e = shopNotice({ storeName: "Leal Glass", s, b, photos: 2, appUrl: "https://app.example/visits" })!;
    expect(e.to).toBe("shop@example.com");
    expect(e.replyTo).toBe("jon@example.com");
    expect(e.html).toContain("&lt;36x48&gt;<br>with lights");
    expect(e.html).toContain("Open in the app (2 photos)");
  });
  it("no shop email when the store didn't set one", () => {
    expect(shopNotice({ storeName: "X", s: bookingSettings({}), b, photos: 0, appUrl: "u" })).toBeNull();
  });
  it("calendar lines stay short", () => {
    const ics = visitIcs({ id: "x", startIso: b.start, minutes: 30, storeName: "A".repeat(200), address: "a", phone: null });
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});

describe("calendar links", () => {
  it("Google and Outlook get the right start, end and place", async () => {
    const { calendarLinks } = await import("../src");
    const l = calendarLinks({ startIso: "2026-11-26T13:15:00.000Z", minutes: 30, title: "Leal: free measure", address: "130 North Ave, Hillside 07205", details: "x" });
    expect(l.google).toContain("dates=20261126T131500Z%2F20261126T134500Z");
    expect(l.google).toContain("location=130+North+Ave%2C+Hillside+07205");
    expect(l.outlook).toContain("startdt=2026-11-26T13%3A15%3A00Z");
    expect(l.outlook).toContain("enddt=2026-11-26T13%3A45%3A00Z");
  });
});
