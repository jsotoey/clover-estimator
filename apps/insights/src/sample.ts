import type { Order } from "./types.js";

/** Deterministic random numbers, so the sample report is the same every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const MENU = [
  { name: "Chicken Roti", cents: 1400, weight: 10 },
  { name: "Goat Roti", cents: 1700, weight: 7 },
  { name: "Doubles", cents: 450, weight: 9 },
  { name: "Oxtail Plate", cents: 1900, weight: 4, trend: 0.25 },   // climbing fast
  { name: "Curry Shrimp", cents: 1800, weight: 4 },
  { name: "Mac Pie", cents: 600, weight: 5, trend: -0.15 },          // slipping
  { name: "Sorrel Drink", cents: 400, weight: 6 },
  { name: "Mauby", cents: 400, weight: 3 },
];
const DAY_WEIGHT = [0.9, 0.55, 0.7, 0.75, 1.0, 1.45, 1.35]; // Sun..Sat
const HOURS = [11, 12, 12, 13, 13, 14, 17, 18, 18, 19, 19, 20];

/**
 * Sample orders for a small Caribbean takeout spot, `weeks` full weeks ending at `end`.
 * Clearly fake: only for showing what the report looks like.
 */
export function sampleOrders(end: Date, weeks = 5, seed = 7): Order[] {
  const r = rng(seed);
  const out: Order[] = [];
  const days = weeks * 7;
  for (let d = days; d >= 1; d--) {
    const day = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - d * 864e5); // UTC midnight
    const weekIdx = Math.floor((days - d) / 7); // 0 = oldest week
    const n = Math.round(38 * DAY_WEIGHT[day.getUTCDay()] * (0.85 + r() * 0.3) * (1 + weekIdx * 0.02));
    for (let i = 0; i < n; i++) {
      const lines: Order["lines"] = [];
      const count = 1 + Math.floor(r() * 3);
      for (let k = 0; k < count; k++) {
        const total = MENU.reduce((a, m) => a + m.weight * (1 + (m.trend ?? 0)) ** weekIdx, 0);
        let pick = r() * total;
        const item = MENU.find((m) => (pick -= m.weight * (1 + (m.trend ?? 0)) ** weekIdx) <= 0) ?? MENU[0];
        const qty = r() < 0.15 ? 2 : 1;
        lines.push({ name: item.name, qty, cents: item.cents * qty });
      }
      const totalCents = lines.reduce((a, l) => a + l.cents, 0);
      // HOURS are New York local times; EST is UTC-5 (sample runs in Nov–Feb).
      const at = new Date(day.getTime() + (HOURS[Math.floor(r() * HOURS.length)] + 5) * 36e5 + Math.floor(r() * 59) * 6e4);
      out.push({
        id: `s${out.length}`, createdAt: at, totalCents,
        tipCents: r() < 0.45 ? Math.round(totalCents * (0.1 + r() * 0.1)) : 0,
        refundCents: r() < 0.01 ? totalCents : 0,
        lines,
      });
    }
  }
  return out;
}
