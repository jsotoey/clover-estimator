/**
 * Online booking for on-site visits (e.g. a free measure). The customer picks a time on our page;
 * the worker then books it in the store's Clover calendar with the address and job details.
 *
 * Times are the store's local wall-clock times (America/New_York by default). All math is done in
 * UTC instants, converting with Intl so daylight saving is handled.
 */

export type Weekday = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
export const WEEKDAYS: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface BookingSettings {
  enabled: boolean;
  service: string;            // bookable service in Clover, e.g. "Free Measure & Estimate"
  employee: string | null;    // Clover employee who does the visits, e.g. "Estimator"
  minutes: number;            // visit length
  bufferMinutes: number;      // blocked after each visit (drive time)
  noticeHours: number;        // earliest bookable = now + this
  maxDays: number;            // bookable dates: tomorrow .. tomorrow + maxDays - 1
  stepMinutes: number;        // start times every N minutes
  hours: Partial<Record<Weekday, [string, string]>>; // "08:00"–"12:00" (24h); missing = closed
  projectTypes: string[];
  timeZone: string;
  phone: string | null;       // shown to customers for changes ("call or text")
}

export const DEFAULT_BOOKING: BookingSettings = {
  enabled: false,
  service: "Free Measure & Estimate",
  employee: null,
  minutes: 30,
  bufferMinutes: 45,
  noticeHours: 24,
  maxDays: 14,
  stepMinutes: 15,
  hours: { mon: ["08:00", "12:00"], tue: ["08:00", "12:00"], wed: ["08:00", "12:00"], thu: ["08:00", "12:00"], fri: ["08:00", "12:00"] },
  projectTypes: ["Shower door or enclosure", "Mirror", "Window or glass repair", "Table top or shelf", "Something else"],
  timeZone: "America/New_York",
  phone: null,
};

/** Merge a store's saved JSON over the defaults, clamping numbers to sane ranges. */
export function bookingSettings(raw: unknown): BookingSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<BookingSettings>;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
  const hours: BookingSettings["hours"] = {};
  const src = r.hours && typeof r.hours === "object" ? r.hours : DEFAULT_BOOKING.hours;
  for (const d of WEEKDAYS) {
    const h = (src as Record<string, unknown>)[d];
    if (Array.isArray(h) && h.length === 2 && h.every((x) => typeof x === "string" && /^\d{2}:\d{2}$/.test(x)) && h[0] < h[1])
      hours[d] = [h[0], h[1]];
  }
  return {
    enabled: r.enabled === true,
    service: typeof r.service === "string" && r.service.trim() ? r.service.trim() : DEFAULT_BOOKING.service,
    employee: typeof r.employee === "string" && r.employee.trim() ? r.employee.trim() : null,
    minutes: num(r.minutes, DEFAULT_BOOKING.minutes, 15, 240),
    bufferMinutes: num(r.bufferMinutes, DEFAULT_BOOKING.bufferMinutes, 0, 180),
    noticeHours: num(r.noticeHours, DEFAULT_BOOKING.noticeHours, 0, 24 * 14),
    maxDays: num(r.maxDays, DEFAULT_BOOKING.maxDays, 1, 60),
    stepMinutes: num(r.stepMinutes, DEFAULT_BOOKING.stepMinutes, 5, 120),
    hours,
    projectTypes: Array.isArray(r.projectTypes) && r.projectTypes.every((x) => typeof x === "string") && r.projectTypes.length
      ? r.projectTypes.slice(0, 12) : DEFAULT_BOOKING.projectTypes,
    timeZone: typeof r.timeZone === "string" && r.timeZone ? r.timeZone : DEFAULT_BOOKING.timeZone,
    phone: typeof r.phone === "string" && /\d{10}/.test(r.phone.replace(/\D/g, "")) ? r.phone.trim() : null,
  };
}

// --- time zone helpers --------------------------------------------------------------------------

/** Offset (ms) of the zone from UTC at the given instant. */
function zoneOffset(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instant)).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** "2026-11-24" + "08:15" in the zone -> UTC instant (ms). */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - zoneOffset(guess, timeZone);
  return guess - zoneOffset(first, timeZone);
}

/** Local calendar date (YYYY-MM-DD) of an instant in the zone. */
export function zonedDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

/** "9:15 AM" style label of an instant in the zone (also what Clover's time picker shows). */
export function zonedClock(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(instant));
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekday(date: string): Weekday {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// --- slots ----------------------------------------------------------------------------------------

export interface Busy { start: number; minutes: number; bufferMinutes: number } // existing visit (UTC ms)
export interface Slot { start: string; label: string }                          // ISO instant + "9:15 AM"
export interface DaySlots { date: string; weekday: Weekday; slots: Slot[] }

/**
 * Open start times, grouped by day, from tomorrow through tomorrow + maxDays - 1.
 * A start is open when: it's within the day's hours (the visit must end by closing; the drive buffer
 * may run past it), it's at least noticeHours from now, and the visit plus its buffer doesn't overlap
 * any existing visit plus that visit's buffer.
 */
export function openSlots(s: BookingSettings, now: number, busy: Busy[]): DaySlots[] {
  const today = zonedDate(now, s.timeZone);
  const earliest = now + s.noticeHours * 3600_000;
  const out: DaySlots[] = [];
  for (let i = 1; i <= s.maxDays; i++) {
    const date = addDays(today, i);
    const wd = weekday(date);
    const hours = s.hours[wd];
    const slots: Slot[] = [];
    if (hours) {
      const [open, close] = [toMin(hours[0]), toMin(hours[1])];
      for (let m = open; m + s.minutes <= close; m += s.stepMinutes) {
        const start = zonedInstant(date, toHHMM(m), s.timeZone);
        if (start < earliest) continue;
        const end = start + (s.minutes + s.bufferMinutes) * 60_000;
        const clash = busy.some((b) => {
          const bEnd = b.start + (b.minutes + b.bufferMinutes) * 60_000;
          return start < bEnd && b.start < end;
        });
        if (!clash) slots.push({ start: new Date(start).toISOString(), label: zonedClock(start, s.timeZone) });
      }
    }
    out.push({ date, weekday: wd, slots });
  }
  return out;
}

/** Is this exact start still open? Used when saving a booking, so two people can't take one slot. */
export function isOpen(s: BookingSettings, now: number, busy: Busy[], startIso: string): boolean {
  return openSlots(s, now, busy).some((d) => d.slots.some((x) => x.start === startIso));
}

// --- the request a customer submits ---------------------------------------------------------------

export interface BookingRequest {
  firstName: string; lastName: string; email: string; phone: string;
  street: string; unit?: string; city: string; zip: string;
  projectType: string; details: string; start: string;
}

/** Returns a list of plain-English problems (empty = OK). */
export function checkBookingRequest(b: Partial<BookingRequest>): string[] {
  const p: string[] = [];
  const has = (v: unknown, n = 1) => typeof v === "string" && v.trim().length >= n;
  if (!has(b.firstName)) p.push("Add your first name.");
  if (!has(b.lastName)) p.push("Add your last name.");
  if (!has(b.email) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email!.trim())) p.push("Add a valid email.");
  const digits = (b.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) p.push("Add a 10-digit phone number.");
  if (!has(b.street, 4)) p.push("Add the street address of the job.");
  if (!has(b.city, 2)) p.push("Add the town.");
  if (!/^\d{5}$/.test((b.zip ?? "").trim())) p.push("Add a 5-digit ZIP code.");
  if (!has(b.projectType)) p.push("Pick what the project is.");
  if (!has(b.details, 5)) p.push("Tell us a little about the job.");
  if (!has(b.start) || Number.isNaN(Date.parse(b.start!))) p.push("Pick a time.");
  for (const [k, max] of [["firstName", 60], ["lastName", 60], ["email", 120], ["street", 120], ["unit", 40], ["city", 60], ["details", 1500]] as const)
    if (typeof b[k] === "string" && (b[k] as string).length > max) p.push(`That ${k === "details" ? "description" : "entry"} is too long.`);
  return p;
}

/**
 * Note for the Clover appointment (Clover cuts notes off around 250 characters), so the person
 * driving out has the address and the gist even without opening the app.
 */
export function visitNote(b: BookingRequest, photos: number): string {
  const addr = [b.street + (b.unit ? ` ${b.unit}` : ""), b.city, b.zip].map((x) => x.trim()).filter(Boolean).join(", ");
  const head = `ADDRESS: ${addr}. PHONE: ${b.phone.trim()}. ${b.projectType}${photos ? ` (${photos} photo${photos > 1 ? "s" : ""} in app)` : ""}: `;
  const room = 250 - head.length;
  const det = b.details.trim().replace(/\s+/g, " ");
  return head + (det.length > room ? det.slice(0, Math.max(0, room - 1)) + "…" : det);
}
