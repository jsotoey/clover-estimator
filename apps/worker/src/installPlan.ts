import { EstimateSchema, earliestInstall, installDate, pickCrew, weekOf, type CrewInfo } from "@ce/core";
import { db, logEvent } from "./db";

/**
 * When a deposit is paid (for a store that books installs): pencil in the install.
 * Date = paid day + supplier lead time (or the store's default) + buffer, on a weekday.
 * Crew = skilled for the job, then least busy that week. The booking in Clover happens next (status to_book).
 */
export async function planInstall(estimateId: string, paidAt: Date): Promise<void> {
  const { rows } = await db().query<{
    merchant_id: number; book_installs: boolean; lead_days: number; buffer_days: number;
    supplier_lead: number | null; estimate: { line_items?: { description?: string }[]; note?: string; service_date?: string } | null; tz: string;
  }>(
    `SELECT e.merchant_id, m.book_installs, m.lead_days, m.buffer_days, s.lead_days AS supplier_lead, e.estimate, 'America/New_York' AS tz
     FROM estimates e JOIN merchants m ON m.id = e.merchant_id LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE e.id = $1`, [estimateId]
  );
  const r = rows[0];
  if (!r || !r.book_installs) return;
  const paidOn = new Intl.DateTimeFormat("en-CA", { timeZone: r.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(paidAt);
  const earliest = earliestInstall(paidOn, r.supplier_lead ?? r.lead_days, r.buffer_days);
  // Keep the start date the customer agreed to on the estimate, unless materials can't be in by then.
  const { date, moved } = installDate(r.estimate?.service_date, earliest);

  const crews = (await db().query<CrewInfo>(`SELECT id, name, skills FROM crews WHERE merchant_id = $1 AND active ORDER BY id`, [r.merchant_id])).rows;
  const load = new Map<number, number>();
  const week = weekOf(date);
  for (const c of (await db().query<{ crew_id: number; n: string }>(
    `SELECT crew_id, count(*) AS n FROM installs WHERE merchant_id = $1 AND crew_id IS NOT NULL
       AND install_date BETWEEN $2::date AND ($2::date + 6) AND status NOT IN ('cancelled','failed') GROUP BY crew_id`, [r.merchant_id, week]
  )).rows) load.set(c.crew_id, Number(c.n));
  const jobText = [...(r.estimate?.line_items ?? []).map((l) => l.description ?? ""), r.estimate?.note ?? ""].join(" ");
  const crew = pickCrew(crews, jobText, load);

  const ins = await db().query(
    `INSERT INTO installs (estimate_id, merchant_id, crew_id, install_date, earliest_date, status, materials)
     VALUES ($1, $2, $3, $4, $5, 'to_book', $6) ON CONFLICT (estimate_id) DO NOTHING`,
    [estimateId, r.merchant_id, crew?.id ?? null, date, earliest, (r.supplier_lead ?? r.lead_days) > 0 ? "ordered" : "none"]
  );
  if (ins.rowCount) await logEvent(estimateId, "install_planned", {
    date, earliest, agreed: r.estimate?.service_date ?? null, moved, crew: crew?.name ?? null,
  });
}

// ---------------------------------------------------------------------------------------------
// Booking: put a planned install into the store's Clover calendar as a tentative appointment.
// ---------------------------------------------------------------------------------------------
import { config } from "./config";
import { newPage, useStore } from "./browser";
import { signedIn, storeById } from "./stores";
import { checkSession, assertRightStore } from "./clover/session";
import { requestLogin } from "./liveLogin";
import { addScreenshot } from "./db";
import { bookAppointment } from "./clover/appointments";
import { FillError } from "./clover/fillEstimate";

export async function processInstall(allowedToSend: (estimate: unknown) => boolean): Promise<boolean> {
  const { rows } = await db().query<{
    id: string; estimate_id: string; merchant_id: number; install_date: string; estimate: unknown; num: string | null;
    crew: string | null; supplier: string | null; service: string; time: string;
  }>(
    `UPDATE installs i SET status = 'booking', updated_at = now()
     FROM estimates e, merchants m
     WHERE e.id = i.estimate_id AND m.id = i.merchant_id
       AND i.id = (SELECT id FROM installs WHERE status = 'to_book' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING i.id, i.estimate_id, i.merchant_id, i.install_date::text AS install_date, e.estimate, e.clover_estimate_number AS num,
       (SELECT name FROM crews WHERE id = i.crew_id) AS crew,
       (SELECT name FROM suppliers WHERE id = e.supplier_id) AS supplier,
       m.install_service AS service, m.install_time AS time`
  );
  const job = rows[0];
  if (!job) return false;
  const store = await storeById(job.merchant_id);
  if (!store) {
    await db().query(`UPDATE installs SET status = 'failed', error = 'Store not found', updated_at = now() WHERE id = $1`, [job.id]);
    return true;
  }
  await useStore(store);
  const page = await newPage();
  // Clover emails the customer when an appointment is booked, so the test lock applies here too.
  const locked = !config.dryRun && !allowedToSend(job.estimate);
  try {
    if (!(await checkSession(page))) {
      await db().query(`UPDATE installs SET status = 'to_book', updated_at = now() WHERE id = $1`, [job.id]);
      signedIn.set(store.id, false);
      await requestLogin("install", store.id);
      return true;
    }
    await assertRightStore(page);
    const note = [
      "TENTATIVE install",
      job.supplier ? `pending materials from ${job.supplier}` : "pending materials",
      job.num ? `Estimate #${job.num}` : null,
      "We'll confirm once everything arrives.",
    ].filter(Boolean).join(". ").replace(/\.\./g, ".");
    const res = await bookAppointment(page, EstimateSchema.parse(job.estimate), {
      date: job.install_date, time: job.time, service: job.service, employee: job.crew, note,
    }, {
      dryRun: config.dryRun || locked,
      onStep: async (step, url) => { await addScreenshot(job.estimate_id, url); await logEvent(job.estimate_id, "install_step", { step }); },
    });
    await db().query(
      `UPDATE installs SET status = $2, booked_date = CASE WHEN $3 THEN install_date ELSE booked_date END, error = $4, updated_at = now() WHERE id = $1`,
      [job.id, res.booked ? "tentative" : "to_confirm", res.booked,
       res.booked ? null : locked ? "Test run only (test lock is on): not booked in Clover" : "Test run only: not booked in Clover"]
    );
    await logEvent(job.estimate_id, res.booked ? "install_booked" : "install_test_run", { date: job.install_date, crew: job.crew });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logEvent(job.estimate_id, "install_failed", { error: msg });
    await db().query(`UPDATE installs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [job.id, e instanceof FillError ? msg : "Something went wrong booking the install in Clover. Nothing was booked. Try again."]);
  } finally {
    await page.close().catch(() => {});
  }
  return true;
}

/**
 * Safety net (DB only, cheap): any deposit marked paid (online or in person) for a store that books installs,
 * without an install yet, gets one planned. Covers "Paid in person" taps and anything missed earlier.
 */
let lastSweep = 0;
export async function planMissingInstalls(): Promise<boolean> {
  if (Date.now() - lastSweep < 60_000) return false;
  lastSweep = Date.now();
  const { rows } = await db().query<{ estimate_id: string; paid: string }>(
    `SELECT i.estimate_id, coalesce(i.paid_at, i.updated_at) AS paid
     FROM invoices i JOIN estimates e ON e.id = i.estimate_id JOIN merchants m ON m.id = e.merchant_id
     WHERE i.kind = 'deposit' AND i.status IN ('paid','paid_in_person') AND m.book_installs
       AND NOT EXISTS (SELECT 1 FROM installs x WHERE x.estimate_id = i.estimate_id)
       AND coalesce(i.paid_at, i.updated_at) > now() - interval '30 days'
     LIMIT 20`
  );
  for (const r of rows) await planInstall(r.estimate_id, new Date(r.paid));
  return rows.length > 0;
}
