import { earliestInstall, pickCrew, weekOf, type CrewInfo } from "@ce/core";
import { db, logEvent } from "./db";

/**
 * When a deposit is paid (for a store that books installs): pencil in the install.
 * Date = paid day + supplier lead time (or the store's default) + buffer, on a weekday.
 * Crew = skilled for the job, then least busy that week. The booking in Clover happens next (status to_book).
 */
export async function planInstall(estimateId: string, paidAt: Date): Promise<void> {
  const { rows } = await db().query<{
    merchant_id: number; book_installs: boolean; lead_days: number; buffer_days: number;
    supplier_lead: number | null; estimate: { line_items?: { description?: string }[]; note?: string } | null; tz: string;
  }>(
    `SELECT e.merchant_id, m.book_installs, m.lead_days, m.buffer_days, s.lead_days AS supplier_lead, e.estimate, 'America/New_York' AS tz
     FROM estimates e JOIN merchants m ON m.id = e.merchant_id LEFT JOIN suppliers s ON s.id = e.supplier_id
     WHERE e.id = $1`, [estimateId]
  );
  const r = rows[0];
  if (!r || !r.book_installs) return;
  const paidOn = new Intl.DateTimeFormat("en-CA", { timeZone: r.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(paidAt);
  const earliest = earliestInstall(paidOn, r.supplier_lead ?? r.lead_days, r.buffer_days);

  const crews = (await db().query<CrewInfo>(`SELECT id, name, skills FROM crews WHERE merchant_id = $1 AND active ORDER BY id`, [r.merchant_id])).rows;
  const load = new Map<number, number>();
  const week = weekOf(earliest);
  for (const c of (await db().query<{ crew_id: number; n: string }>(
    `SELECT crew_id, count(*) AS n FROM installs WHERE merchant_id = $1 AND crew_id IS NOT NULL
       AND install_date BETWEEN $2::date AND ($2::date + 6) AND status NOT IN ('cancelled','failed') GROUP BY crew_id`, [r.merchant_id, week]
  )).rows) load.set(c.crew_id, Number(c.n));
  const jobText = [...(r.estimate?.line_items ?? []).map((l) => l.description ?? ""), r.estimate?.note ?? ""].join(" ");
  const crew = pickCrew(crews, jobText, load);

  const ins = await db().query(
    `INSERT INTO installs (estimate_id, merchant_id, crew_id, install_date, earliest_date, status, materials)
     VALUES ($1, $2, $3, $4, $4, 'to_book', $5) ON CONFLICT (estimate_id) DO NOTHING`,
    [estimateId, r.merchant_id, crew?.id ?? null, earliest, (r.supplier_lead ?? r.lead_days) > 0 ? "ordered" : "none"]
  );
  if (ins.rowCount) await logEvent(estimateId, "install_planned", { date: earliest, crew: crew?.name ?? null });
}
