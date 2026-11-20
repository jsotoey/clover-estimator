import { splitInvoices, type Estimate, type PricingResult } from "@ce/core";
import { db, logEvent, addScreenshot } from "./db";
import { config } from "./config";
import { newPage } from "./browser";
import { fillInvoice, readEstimateStatuses, FillError } from "./clover/fillEstimate";

/** Right after an estimate is really sent: set up its deposit and balance invoices (held in the app). */
export async function createInvoiceRows(estimateId: string, rawEstimate: unknown, rawComputed: unknown) {
  const e = rawEstimate as Estimate;
  const c = rawComputed as PricingResult;
  const split = splitInvoices(c.subtotalCents, config.taxRate ?? 0, e.taxable, e.deposit_percent);
  const rows: [string, typeof split.balance][] = [];
  if (split.deposit) rows.push(["deposit", split.deposit]);
  rows.push(["balance", split.balance]);
  for (const [kind, p] of rows) {
    await db().query(
      `INSERT INTO invoices (estimate_id, kind, subtotal_cents, tax_cents, total_cents) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (estimate_id, kind) DO NOTHING`,
      [estimateId, kind, p.subtotalCents, p.taxCents, p.totalCents]
    );
  }
}

interface InvoiceJob {
  id: string; kind: "deposit" | "balance"; subtotal_cents: number; total_cents: number;
  estimate_id: string; estimate: unknown; clover_estimate_number: string | null;
}

async function claimInvoice(): Promise<InvoiceJob | null> {
  const { rows } = await db().query<InvoiceJob>(
    `UPDATE invoices i SET status = 'sending', updated_at = now()
     FROM estimates e
     WHERE e.id = i.estimate_id AND i.id = (SELECT id FROM invoices WHERE status = 'approved' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING i.id, i.kind, i.subtotal_cents, i.total_cents, i.estimate_id, e.estimate, e.clover_estimate_number`
  );
  return rows[0] ?? null;
}

function invoiceText(job: InvoiceJob): { itemName: string; note: string } {
  const e = job.estimate as Estimate;
  const num = job.clover_estimate_number ? `Estimate #${job.clover_estimate_number}` : "your estimate";
  const work = e.line_items.map((l) => l.description).join(", ");
  const test = /^\s*TEST\b/i.test(e.note) ? "TEST INVOICE, please ignore. " : "";
  const label = job.kind === "deposit" ? `Deposit (${e.deposit_percent}%)` : e.deposit_percent > 0 ? "Balance" : "Payment";
  // Clover cuts item names at 80 characters, so the item stays short and the work goes in the note.
  const thanks = job.kind === "deposit" ? "Thank you, this locks in your start date." : "Thank you for your business!";
  const head = `${test}${label} for ${num}.`;
  const room = 200 - head.length - thanks.length - 3;
  const workText = room > 10 ? ` ${work.length > room ? work.slice(0, room - 1) + "…" : work}.` : "";
  return {
    itemName: `${label} for ${num}`.slice(0, 80),
    note: `${head}${workText} ${thanks}`.slice(0, 200),
  };
}

/** Send one approved invoice. Returns true if there was one to do. */
export async function processInvoice(allowedToSend: (estimate: unknown) => boolean): Promise<boolean> {
  const job = await claimInvoice();
  if (!job) return false;
  const page = await newPage();
  const locked = !config.dryRun && !allowedToSend(job.estimate);
  try {
    const res = await fillInvoice(page, job.estimate, { ...invoiceText(job), subtotalCents: job.subtotal_cents, totalCents: job.total_cents }, {
      dryRun: config.dryRun || locked,
      taxRate: config.taxRate,
      onStep: async (step, url) => {
        await addScreenshot(job.estimate_id, url);
        await logEvent(job.estimate_id, "invoice_step", { kind: job.kind, step });
      },
    });
    await db().query(
      `UPDATE invoices SET status = $2, pay_link = $3, error = $4, updated_at = now() WHERE id = $1`,
      [job.id, res.sent ? "sent" : "waiting", res.payLink ?? null, res.sent ? null : locked ? "Test run only (test lock is on)" : "Test run only (nothing sent)"]
    );
    await logEvent(job.estimate_id, res.sent ? "invoice_sent" : "invoice_test_run", { kind: job.kind, total: job.total_cents, payLink: !!res.payLink });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent(job.estimate_id, "invoice_failed", { kind: job.kind, error: msg });
    const friendly = e instanceof FillError ? msg : "Something went wrong making the invoice in Clover. See the screenshot, then try again.";
    await db().query(`UPDATE invoices SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [job.id, friendly]);
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}

/**
 * Every few minutes: look at Clover's estimates list for estimates we sent that the customer has
 * accepted. Records it, and sends the deposit invoice right away if the merchant chose that.
 */
let lastCheck = 0;
export async function checkAcceptances(): Promise<boolean> {
  if (Date.now() - lastCheck < config.acceptCheckMs) return false;
  lastCheck = Date.now();
  const { rows } = await db().query<{ id: string; num: string }>(
    `SELECT id, clover_estimate_number AS num FROM estimates
     WHERE status = 'sent' AND accepted_at IS NULL AND clover_estimate_number IS NOT NULL
       AND coalesce(error, '') NOT LIKE 'dry run%' AND coalesce(sent_at, updated_at) > now() - interval '45 days'`
  );
  if (!rows.length) return false;
  const page = await newPage();
  try {
    const statuses = await readEstimateStatuses(page);
    for (const r of rows) {
      const s = statuses.get(r.num);
      await db().query(`UPDATE estimates SET checked_at = now() WHERE id = $1`, [r.id]);
      if (!s || !/accepted|converted/i.test(s)) continue;
      await db().query(`UPDATE estimates SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`, [r.id]);
      await logEvent(r.id, "customer_accepted", { cloverNumber: r.num });
      if (config.depositAutoSend) {
        await db().query(`UPDATE invoices SET status = 'approved', updated_at = now() WHERE estimate_id = $1 AND kind = 'deposit' AND status = 'waiting'`, [r.id]);
      }
    }
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}
