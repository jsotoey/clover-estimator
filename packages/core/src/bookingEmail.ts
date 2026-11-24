import type { BookingRequest, BookingSettings } from "./booking";
import { zonedClock, zonedDate } from "./booking";

/**
 * Emails sent the moment a visit is booked on our page (not waiting on Clover):
 *  - the customer: confirmation with date, time, address, what to expect, a calendar file
 *  - the shop (if it set an email): "new booking" with everything the estimator needs
 * Plain words, no marketing. Pure functions: sending happens in the web app.
 */

export interface Email { to: string; subject: string; text: string; html: string; replyTo?: string; attachments?: { Name: string; Content: string; ContentType: string }[] }

/** UTF-8 base64 without Node's Buffer (this module is also bundled for the browser). */
const base64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (c) => String.fromCharCode(c)).join(""));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const nl2br = (s: string) => esc(s).replace(/\n/g, "<br>");

export function longDate(startIso: string, timeZone: string): string {
  const d = zonedDate(Date.parse(startIso), timeZone);
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function fullAddress(b: Pick<BookingRequest, "street" | "unit" | "city" | "zip">): string {
  return `${b.street.trim()}${b.unit?.trim() ? `, ${b.unit.trim()}` : ""}, ${b.city.trim()} ${b.zip.trim()}`;
}

/** A calendar file (.ics) so the customer can add the visit with one tap. */
export function visitIcs(o: { id: string; startIso: string; minutes: number; storeName: string; address: string; phone: string | null; now?: number }): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = Date.parse(o.startIso);
  const fold = (line: string) => line.match(/.{1,73}/g)!.join("\r\n "); // RFC 5545 line folding
  const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fixro//Booking//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    `UID:${o.id}@fixro`, `DTSTAMP:${stamp(o.now ?? Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(start + o.minutes * 60_000)}`,
    fold(`SUMMARY:${text(`${o.storeName} visit (free measure)`)}`),
    fold(`LOCATION:${text(o.address)}`),
    fold(`DESCRIPTION:${text(`${o.storeName} is coming to measure.${o.phone ? ` Need to change it? Call or text ${o.phone}.` : ""}`)}`),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

function layout(title: string, body: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F6F5F1;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#16201B">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #E4E1D8;border-radius:18px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.25">${esc(title)}</h1>${body}</div>
<p style="color:#5C665F;font-size:12px;text-align:center;margin:16px 0 0">${footer}</p></div></body></html>`;
}

const row = (k: string, v: string) =>
  `<tr><td style="padding:6px 12px 6px 0;color:#5C665F;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-size:15px;font-weight:600">${v}</td></tr>`;

export function customerConfirmation(o: { id: string; storeName: string; s: BookingSettings; b: BookingRequest; now?: number }): Email {
  const { s, b } = o;
  const day = longDate(b.start, s.timeZone);
  const time = zonedClock(Date.parse(b.start), s.timeZone);
  const addr = fullAddress(b);
  const change = s.phone ? `Need to change it? Call or text ${s.phone}.` : `Need to change it? Just reply to this email.`;
  const links = calendarLinks({ startIso: b.start, minutes: s.minutes, title: `${o.storeName}: free measure`, address: addr,
    details: `${o.storeName} is coming to measure (${b.projectType}).${s.phone ? ` To change it, call or text ${s.phone}.` : ""}` });
  const calBtn = (href: string, label: string) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 6px 8px 0;padding:10px 14px;border:1px solid #CFCBC0;border-radius:10px;color:#16201B;text-decoration:none;font-size:14px;font-weight:600">${label}</a>`;
  const text = [
    `Hi ${b.firstName.trim()},`, "",
    `You're booked for a free measure with ${o.storeName}.`, "",
    `When: ${day} at ${time} (about ${s.minutes} minutes)`,
    `Where: ${addr}`,
    `Project: ${b.projectType}`, "",
    `We'll measure, go over options with you, and send you a written estimate after the visit. No cost and no deposit.`, "",
    change, "",
    `Add it to your calendar:`, `Google: ${links.google}`, `Outlook: ${links.outlook}`, `Apple: open the visit.ics file attached`, "",
    `${o.storeName}`,
  ].join("\n");
  const html = layout(`You're booked, ${b.firstName.trim()}`,
    `<p style="margin:0 0 16px;font-size:15px">Free measure with <b>${esc(o.storeName)}</b>.</p>
<table style="border-collapse:collapse;margin:0 0 16px">${row("When", `${esc(day)} at ${esc(time)}`)}${row("Where", esc(addr))}${row("Project", esc(b.projectType))}</table>
<p style="margin:0 0 12px;font-size:15px;line-height:1.5">We'll measure, go over options with you, and send you a written estimate after the visit. No cost and no deposit.</p>
<p style="margin:0 0 8px;font-size:14px;font-weight:700">Add it to your calendar</p>
<div style="margin:0 0 16px">${calBtn(links.google, "Google Calendar")}${calBtn(links.outlook, "Outlook")}<span style="display:inline-block;font-size:13px;color:#5C665F">Apple: open the attached visit.ics</span></div>
<p style="margin:0;font-size:15px">${s.phone ? `Need to change it? Call or text <a href="tel:${s.phone.replace(/\D/g, "")}" style="color:#1F6B45;font-weight:600">${esc(s.phone)}</a>.` : "Need to change it? Just reply to this email."}</p>`,
    `${esc(o.storeName)} · The calendar file attached adds this visit to your phone.`);
  return {
    to: b.email.trim(), replyTo: s.notifyEmail ?? undefined,
    subject: `You're booked: ${day.replace(/^\w+, /, "")} at ${time} with ${o.storeName}`,
    text, html,
    attachments: [{
      Name: "visit.ics", ContentType: "text/calendar; charset=utf-8; method=PUBLISH",
      Content: base64(visitIcs({ id: o.id, startIso: b.start, minutes: s.minutes, storeName: o.storeName, address: addr, phone: s.phone, now: o.now })),
    }],
  };
}

export function shopNotice(o: { storeName: string; s: BookingSettings; b: BookingRequest; photos: number; appUrl: string }): Email | null {
  const { s, b } = o;
  if (!s.notifyEmail) return null;
  const day = longDate(b.start, s.timeZone);
  const time = zonedClock(Date.parse(b.start), s.timeZone);
  const addr = fullAddress(b);
  const who = `${b.firstName.trim()} ${b.lastName.trim()}`;
  const text = [
    `New visit booked online`, "",
    `${day} at ${time} (${s.minutes} min)`, `${who}  ${b.phone}  ${b.email}`, `${addr}`, "",
    `${b.projectType}`, b.details.trim(), "",
    o.photos ? `${o.photos} photo${o.photos > 1 ? "s" : ""} in the app: ${o.appUrl}` : `Details in the app: ${o.appUrl}`,
  ].join("\n");
  const html = layout(`New visit: ${day.replace(/^\w+, /, "")} at ${time}`,
    `<table style="border-collapse:collapse;margin:0 0 16px">${row("Customer", esc(who))}${row("Phone", `<a href="tel:${b.phone.replace(/\D/g, "")}" style="color:#1F6B45">${esc(b.phone)}</a>`)}${row("Email", esc(b.email))}${row("Address", `<a href="https://maps.google.com/?q=${encodeURIComponent(addr)}" style="color:#1F6B45">${esc(addr)}</a>`)}${row("Project", esc(b.projectType))}</table>
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;background:#F6F5F1;border-radius:12px;padding:12px">${nl2br(b.details.trim())}</p>
<p style="margin:0"><a href="${esc(o.appUrl)}" style="display:inline-block;background:#1F6B45;color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:12px">Open in the app${o.photos ? ` (${o.photos} photo${o.photos > 1 ? "s" : ""})` : ""}</a></p>`,
    `Booked on your online booking page. It's added to the Clover calendar automatically.`);
  return { to: s.notifyEmail, replyTo: b.email.trim(), subject: `New visit: ${who}, ${day.replace(/^\w+, /, "")} at ${time}`, text, html };
}

/** One-tap "add to calendar" links for the confirmation screen and email (Apple uses the .ics file). */
export function calendarLinks(o: { startIso: string; minutes: number; title: string; address: string; details: string }) {
  const start = Date.parse(o.startIso);
  const end = start + o.minutes * 60_000;
  const compact = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}/, "");
  const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
  return {
    google: `https://calendar.google.com/calendar/render?${q({ action: "TEMPLATE", text: o.title, dates: `${compact(start)}/${compact(end)}`, details: o.details, location: o.address })}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${q({ path: "/calendar/action/compose", rru: "addevent", subject: o.title, startdt: iso(start), enddt: iso(end), location: o.address, body: o.details })}`,
    office365: `https://outlook.office.com/calendar/0/deeplink/compose?${q({ path: "/calendar/action/compose", rru: "addevent", subject: o.title, startdt: iso(start), enddt: iso(end), location: o.address, body: o.details })}`,
  };
}
