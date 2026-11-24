import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Merchant, Order } from "./types.js";
import { buildReport, facts, lastFullWeek } from "./metrics.js";
import { writeDraft } from "./write.js";
import { emailHtml, emailText } from "./email.js";
import { sampleOrders } from "./sample.js";
import { cloverOrders } from "./clover.js";

/**
 * Weekly client snapshot. For each merchant in merchants.json: pull 5 weeks of orders,
 * do the math, have the AI word it (numbers checked), and save an email DRAFT for Jon to review.
 * Nothing is sent from here.
 *   pnpm --filter insights weekly              (uses merchants.json, else the sample merchant)
 *   NOW=2026-11-23 pnpm --filter insights weekly
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "..");

async function loadMerchants(): Promise<Merchant[]> {
  const file = path.join(root, "merchants.json");
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  return [{ id: "sample-roti", name: "Sample Roti Shop", contactName: "Sam", email: "owner@example.com", timezone: "America/New_York", sample: true }];
}

async function ordersFor(m: Merchant, now: Date): Promise<Order[]> {
  if (m.sample) return sampleOrders(now, 6);
  const token = m.tokenEnv ? process.env[m.tokenEnv] : undefined;
  if (!token) throw new Error(`no token: set ${m.tokenEnv ?? "tokenEnv"} for ${m.name}`);
  const { start } = lastFullWeek(now, m.timezone);
  const from = new Date(new Date(`${start}T00:00:00Z`).getTime() - 29 * 864e5);
  return cloverOrders(m.id, token, from, now);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const now = process.env.NOW ? new Date(`${process.env.NOW}T15:00:00Z`) : new Date();
  const merchants = await loadMerchants();
  const outDir = path.join(root, "out", now.toISOString().slice(0, 10));
  await mkdir(outDir, { recursive: true });
  const index: string[] = [];
  for (const m of merchants) {
    try {
      const orders = await ordersFor(m, now);
      const report = buildReport(orders, now, m.timezone);
      if (report.week.orders === 0) { console.log(`[insights] ${m.name}: no sales last week, skipped`); continue; }
      const f = facts(report);
      const draft = await writeDraft(m, report, f, process.env.ANTHROPIC_API_KEY);
      const base = path.join(outDir, slug(m.name));
      await writeFile(`${base}.html`, emailHtml(m, draft, report));
      await writeFile(`${base}.txt`, `To: ${m.email}\nSubject: ${draft.subject}\n\n${emailText(draft)}\n`);
      await writeFile(`${base}.facts.json`, JSON.stringify({ merchant: m.name, week: report.week.start, facts: f, writer: draft.writer }, null, 2));
      index.push(`<li><a href="${slug(m.name)}.html">${m.name}</a>: ${draft.subject} <small>(${draft.writer})</small></li>`);
      console.log(`[insights] ${m.name}: draft ready (${draft.writer}) → ${base}.html`);
    } catch (e) {
      console.error(`[insights] ${m.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await writeFile(path.join(outDir, "index.html"), `<!doctype html><meta charset="utf-8"><title>Weekly drafts</title><h1>Weekly drafts</h1><ul>${index.join("")}</ul>`);
}

main();
