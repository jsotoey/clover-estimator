import type { Order } from "./types.js";

/** All the arithmetic lives here, in code. The AI only gets to word these results. */

export interface WeekStats {
  start: string; end: string;          // local dates, Mon..Sun, YYYY-MM-DD
  salesCents: number;                  // goods sold, before tips, after refunds
  orders: number;
  avgTicketCents: number;
  tipsCents: number;
  refundsCents: number;
  items: Map<string, { qty: number; cents: number }>;
  byDay: number[];                     // sales cents, Mon..Sun
  byHour: number[];                    // order counts, 0..23 local
}

/** usualQty = average weekly qty over the prior weeks (up to 4), a steadier baseline than one week. */
export interface ItemRow { name: string; qty: number; cents: number; usualQty: number; changePct: number | null }

export interface WeeklyReport {
  week: WeekStats;
  prev: WeekStats;
  avg4: { salesCents: number; orders: number; avgTicketCents: number };
  salesVsPrevPct: number | null;
  salesVsAvgPct: number | null;
  ordersVsPrevPct: number | null;
  ticketVsPrevPct: number | null;
  topItems: ItemRow[];                 // by sales, top 5
  risers: ItemRow[];                   // biggest qty gains vs their usual week (meaningful volume only)
  fallers: ItemRow[];
  bestDay: { day: string; salesCents: number } | null;
  busiestHour: { label: string; orders: number } | null;
  weeksOfHistory: number;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday as string);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, dow };
}

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The last full Mon–Sun week before `now`, in the merchant's time zone. */
export function lastFullWeek(now: Date, tz: string): { start: string; end: string } {
  const { date, dow } = localParts(now, tz);
  const thisMonday = addDays(date, -dow);
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}

export function weekStats(orders: Order[], start: string, tz: string): WeekStats {
  const end = addDays(start, 6);
  const s: WeekStats = { start, end, salesCents: 0, orders: 0, avgTicketCents: 0, tipsCents: 0, refundsCents: 0, items: new Map(), byDay: Array(7).fill(0), byHour: Array(24).fill(0) };
  for (const o of orders) {
    const lp = localParts(o.createdAt, tz);
    if (lp.date < start || lp.date > end) continue;
    const net = o.totalCents - o.refundCents;
    s.salesCents += net;
    s.orders += 1;
    s.tipsCents += o.tipCents;
    s.refundsCents += o.refundCents;
    s.byDay[lp.dow] += net;
    s.byHour[lp.hour] += 1;
    if (o.refundCents >= o.totalCents) continue; // fully refunded: don't count its items
    for (const l of o.lines) {
      const it = s.items.get(l.name) ?? { qty: 0, cents: 0 };
      it.qty += l.qty; it.cents += l.cents;
      s.items.set(l.name, it);
    }
  }
  s.avgTicketCents = s.orders ? Math.round(s.salesCents / s.orders) : 0;
  return s;
}

export const pctChange = (now: number, before: number): number | null =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

export function buildReport(orders: Order[], now: Date, tz: string): WeeklyReport {
  const { start } = lastFullWeek(now, tz);
  const week = weekStats(orders, start, tz);
  const prev = weekStats(orders, addDays(start, -7), tz);
  const prior = [1, 2, 3, 4].map((k) => weekStats(orders, addDays(start, -7 * k), tz)).filter((w) => w.orders > 0);
  const avg = (f: (w: WeekStats) => number) => (prior.length ? Math.round(prior.reduce((a, w) => a + f(w), 0) / prior.length) : 0);
  const avg4 = { salesCents: avg((w) => w.salesCents), orders: avg((w) => w.orders), avgTicketCents: avg((w) => w.avgTicketCents) };

  const rows: ItemRow[] = [...week.items].map(([name, v]) => {
    const usualQty = prior.length ? Math.round(prior.reduce((a, w) => a + (w.items.get(name)?.qty ?? 0), 0) / prior.length) : 0;
    return { name, qty: v.qty, cents: v.cents, usualQty, changePct: pctChange(v.qty, usualQty) };
  });
  const topItems = [...rows].sort((a, b) => b.cents - a.cents).slice(0, 5);
  // Movers need real volume on both sides, so one extra sale doesn't read as "+100%".
  const minQty = Math.max(8, Math.round(week.orders * 0.03));
  const movable = prior.length >= 2 ? rows.filter((r) => r.changePct !== null && Math.max(r.qty, r.usualQty) >= minQty && r.usualQty >= 5) : [];
  const risers = movable.filter((r) => (r.changePct ?? 0) >= 15).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, 2);
  const fallers = movable.filter((r) => (r.changePct ?? 0) <= -15).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 2);

  const bestIdx = week.byDay.indexOf(Math.max(...week.byDay));
  const hourIdx = week.byHour.indexOf(Math.max(...week.byHour));
  return {
    week, prev, avg4,
    salesVsPrevPct: pctChange(week.salesCents, prev.salesCents),
    salesVsAvgPct: pctChange(week.salesCents, avg4.salesCents),
    ordersVsPrevPct: pctChange(week.orders, prev.orders),
    ticketVsPrevPct: pctChange(week.avgTicketCents, prev.avgTicketCents),
    topItems, risers, fallers,
    bestDay: week.orders ? { day: DAYS[bestIdx], salesCents: week.byDay[bestIdx] } : null,
    busiestHour: week.orders ? { label: `${hourLabel(hourIdx)} to ${hourLabel((hourIdx + 1) % 24)}`, orders: week.byHour[hourIdx] } : null,
    weeksOfHistory: prior.length,
  };
}

// ---------- formatting (the only number strings the writer may use) ----------
export const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const usd2 = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signed = (p: number) => `${p > 0 ? "up" : "down"} ${Math.abs(p)}%`;

/** Plain-language facts, each a sentence with its numbers already formatted. */
export function facts(r: WeeklyReport): string[] {
  const f: string[] = [];
  const w = r.week;
  f.push(`Sales last week (${w.start} to ${w.end}) were ${usd(w.salesCents)} from ${w.orders} orders.`);
  if (r.salesVsPrevPct !== null) f.push(`Sales were ${signed(r.salesVsPrevPct)} vs the week before (${usd(r.prev.salesCents)}).`);
  if (r.salesVsAvgPct !== null && r.weeksOfHistory >= 3) f.push(`Sales were ${signed(r.salesVsAvgPct)} vs the ${r.weeksOfHistory}-week average of ${usd(r.avg4.salesCents)}.`);
  if (r.ordersVsPrevPct !== null) f.push(`Orders were ${signed(r.ordersVsPrevPct)} vs the week before (${r.prev.orders} orders).`);
  f.push(`The average order was ${usd2(w.avgTicketCents)}${r.ticketVsPrevPct !== null && r.ticketVsPrevPct !== 0 ? `, ${signed(r.ticketVsPrevPct)} vs the week before` : ""}.`);
  if (r.topItems[0]) f.push(`Top seller by sales: ${r.topItems[0].name}, ${r.topItems[0].qty} sold for ${usd(r.topItems[0].cents)}.`);
  r.risers.forEach((x) => f.push(`${x.name} is climbing: ${x.qty} sold last week, ${signed(x.changePct!)} vs its usual ${x.usualQty} a week.`));
  r.fallers.forEach((x) => f.push(`${x.name} slowed down: ${x.qty} sold last week, ${signed(x.changePct!)} vs its usual ${x.usualQty} a week.`));
  if (r.bestDay) f.push(`Best day: ${r.bestDay.day}, with ${usd(r.bestDay.salesCents)} in sales.`);
  if (r.busiestHour) f.push(`Busiest hour: ${r.busiestHour.label}, with ${r.busiestHour.orders} orders.`);
  if (w.tipsCents > 0) f.push(`Customers left ${usd(w.tipsCents)} in tips.`);
  if (w.refundsCents > 0) f.push(`Refunds came to ${usd(w.refundsCents)}.`);
  return f;
}
