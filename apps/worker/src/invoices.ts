import { splitInvoices, type Estimate, type PricingResult } from "@ce/core";
import { db, logEvent, addScreenshot } from "./db";
import { config } from "./config";
import { newPage, useStore } from "./browser";
import { activeStore, loadStores, signedIn, storeById } from "./stores";
import { requestLogin } from "./liveLogin";
import { planInstall } from "./installPlan";
import { checkSession, assertRightStore } from "./clover/session";
import { fillInvoice, readEstimateStatuses, readInvoiceRows, matchInvoiceRows, isPaidStatus, FillError } from "./clover/fillEstimate";

/** Right after an estimate is really sent: set up its deposit and balance invoices (held in the app). */
export async function createInvoiceRows(estimateId: string, rawEstimate: unknown, rawComputed: unknown) {
  const e = rawEstimate as Estimate;
  const c = rawComputed as PricingResult;
  const split = splitInvoices(c.subtotalCents, activeStore().taxRate, e.taxable, e.deposit_percent);
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
  estimate_id: string; estimate: unknown; clover_estimate_number: string | null; merchant_id: number; deposit_note: string | null;
}

async function claimInvoice(): Promise<InvoiceJob | null> {
  const { rows } = await db().query<InvoiceJob>(
    `UPDATE invoices i SET status = 'sending', updated_at = now()
     FROM estimates e
     WHERE e.id = i.estimate_id AND i.id = (SELECT iv.id FROM invoices iv JOIN estimates ev ON ev.id = iv.estimate_id
                                        WHERE iv.status = 'approved' AND ev.merchant_id IS NOT NULL ORDER BY iv.updated_at FOR UPDATE OF iv SKIP LOCKED LIMIT 1)
     RETURNING i.id, i.kind, i.subtotal_cents, i.total_cents, i.estimate_id, e.estimate, e.clover_estimate_number, e.merchant_id,
               (SELECT deposit_note FROM merchants WHERE id = e.merchant_id) AS deposit_note`
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
  const thanks = job.kind === "deposit" ? (job.deposit_note?.trim() || "Thank you, this locks in your start date.") : "Thank you for your business!";
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
  const store = await storeById(job.merchant_id);
  if (!store) {
    await db().query(`UPDATE invoices SET status = 'failed', error = 'Store not found', updated_at = now() WHERE id = $1`, [job.id]);
    return true;
  }
  await useStore(store);
  const page = await newPage();
  const locked = !config.dryRun && !allowedToSend(job.estimate);
  try {
    if (!(await checkSession(page))) {
      // Signed out: put it back in line and ask for a sign-in. It goes out right after.
      await db().query(`UPDATE invoices SET status = 'approved', updated_at = now() WHERE id = $1`, [job.id]);
      signedIn.set(store.id, false);
      await requestLogin("invoice", store.id);
      return true;
    }
    await assertRightStore(page);
    const res = await fillInvoice(page, job.estimate, { ...invoiceText(job), subtotalCents: job.subtotal_cents, totalCents: job.total_cents }, {
      dryRun: config.dryRun || locked,
      taxRate: store.taxRate,
      onStep: async (step, url) => {
        await addScreenshot(job.estimate_id, url);
        await logEvent(job.estimate_id, "invoice_step", { kind: job.kind, step });
      },
    });
    await db().query(
      `UPDATE invoices SET status = $2, pay_link = $3, error = $4, clover_invoice_number = $5,
         sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END, updated_at = now() WHERE id = $1`,
      [job.id, res.sent ? "sent" : "waiting", res.payLink ?? null, res.sent ? null : locked ? "Test run only (test lock is on)" : "Test run only (nothing sent)", res.cloverNumber ?? null]
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
/**
 * Every few minutes, per store: has the customer accepted an estimate we sent, and has an invoice we
 * sent been paid? A paid deposit pencils in the install (for stores that book installs).
 */
let lastPeek = 0;
let hurry = false;
export async function checkAcceptances(): Promise<boolean> {
  // Normally every few minutes. Faster (45s) for an hour after an estimate or invoice goes out, and right
  // away when someone taps "Check now" in the app. The cheap database peek runs at most every 10 seconds.
  if (Date.now() - lastPeek > 10_000) {
    lastPeek = Date.now();
    const { rows } = await db().query<{ now: boolean; recent: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM events WHERE type = 'check_now' AND created_at > to_timestamp($1 / 1000.0)) AS now,
              EXISTS (SELECT 1 FROM estimates WHERE status = 'sent' AND accepted_at IS NULL AND sent_at > now() - interval '60 minutes')
                OR EXISTS (SELECT 1 FROM invoices WHERE status = 'sent' AND sent_at > now() - interval '60 minutes') AS recent`,
      [lastCheck]).catch(() => ({ rows: [{ now: false, recent: false }] }));
    hurry = rows[0].now;
    if (rows[0].recent && Date.now() - lastCheck >= 45_000) hurry = true;
  }
  if (!hurry && Date.now() - lastCheck < config.acceptCheckMs) return false;
  hurry = false;
  lastCheck = Date.now();
  const est = (await db().query<{ id: string; num: string; merchant_id: number }>(
    `SELECT id, clover_estimate_number AS num, merchant_id FROM estimates
     WHERE status = 'sent' AND accepted_at IS NULL AND clover_estimate_number IS NOT NULL AND merchant_id IS NOT NULL
       AND coalesce(error, '') NOT LIKE 'dry run%' AND coalesce(sent_at, updated_at) > now() - interval '45 days'`
  )).rows;
  const inv = (await db().query<{ id: string; estimate_id: string; kind: string; total_cents: number; num: string | null; customer: string; merchant_id: number }>(
    `SELECT i.id, i.estimate_id, i.kind, i.total_cents, i.clover_invoice_number AS num,
            coalesce(e.estimate->'customer'->>'name', '') AS customer, e.merchant_id
     FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.status = 'sent' AND e.merchant_id IS NOT NULL AND coalesce(i.sent_at, i.updated_at) > now() - interval '120 days'`
  )).rows;
  if (!est.length && !inv.length) return false;
  for (const store of await loadStores()) {
    const myEst = est.filter((r) => r.merchant_id === store.id);
    const myInv = inv.filter((r) => r.merchant_id === store.id);
    if ((!myEst.length && !myInv.length) || signedIn.get(store.id) === false) continue;
    await useStore(store);
    const page = await newPage();
    try {
      if (!(await checkSession(page))) { signedIn.set(store.id, false); continue; }
      await assertRightStore(page);
      if (myEst.length) {
        const statuses = await readEstimateStatuses(page);
        for (const r of myEst) {
          const st = statuses.get(r.num);
          await db().query(`UPDATE estimates SET checked_at = now() WHERE id = $1`, [r.id]);
          if (!st || !/accepted|converted/i.test(st)) continue;
          await db().query(`UPDATE estimates SET accepted_at = now() WHERE id = $1 AND accepted_at IS NULL`, [r.id]);
          await logEvent(r.id, "customer_accepted", { cloverNumber: r.num });
          if (config.depositAutoSend) {
            await db().query(`UPDATE invoices SET status = 'approved', updated_at = now() WHERE estimate_id = $1 AND kind = 'deposit' AND status = 'waiting'`, [r.id]);
          }
        }
      }
      if (myInv.length) {
        const rows = await readInvoiceRows(page);
        const claimed = new Set<string>();
        for (const r of myInv) {
          // Prefer Clover's invoice number; otherwise customer + amount (oldest unclaimed match).
          const row = (r.num && rows.find((x) => x.number === r.num))
            || matchInvoiceRows(rows, r.customer, r.total_cents).filter((x) => !claimed.has(x.number || x.reference)).pop();
          if (!row) continue;
          claimed.add(row.number || row.reference);
          if (!r.num && row.number) await db().query(`UPDATE invoices SET clover_invoice_number = $2 WHERE id = $1`, [r.id, row.number]);
          if (!isPaidStatus(row.status)) continue;
          const upd = await db().query(
            `UPDATE invoices SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1 AND status = 'sent'`, [r.id]
          );
          if (!upd.rowCount) continue;
          await logEvent(r.estimate_id, "invoice_paid", { kind: r.kind, total: r.total_cents, cloverNumber: row.number });
          if (r.kind === "deposit") await planInstall(r.estimate_id, new Date());
        }
      }
    } catch (e) {
      console.error(`[clover check] ${store.name}:`, e instanceof Error ? e.message : e);
    } finally {
      await page.close().catch(() => {});
    }
  }
  return true;
}
