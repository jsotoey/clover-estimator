import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/**
 * The install's next steps, from the estimate screen:
 *   arrived  materials are in: the penciled-in date is confirmed
 *   delayed  materials are late: move the install to a new date (not before the earliest allowed)
 *   retry    booking in Clover failed: try again
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const { action, date } = (await req.json().catch(() => ({}))) as { action?: string; date?: string };

  if (action === "arrived") {
    const r = await db().query(
      `UPDATE installs SET materials = 'arrived', status = CASE WHEN status IN ('tentative','to_confirm') THEN 'confirmed' ELSE status END,
         updated_at = now() WHERE estimate_id = $1 AND status NOT IN ('cancelled','done') RETURNING status`, [id]);
    return r.rowCount ? Response.json({ ok: true, status: r.rows[0].status }) : Response.json({ error: "No install to update" }, { status: 400 });
  }
  if (action === "delayed") {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Pick the new install date" }, { status: 400 });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    if (date < today) return Response.json({ error: "The new date has to be in the future" }, { status: 400 });
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return Response.json({ error: "Pick a weekday" }, { status: 400 });
    const r = await db().query(
      `UPDATE installs SET materials = 'delayed', install_date = $2,
         status = CASE WHEN booked_date IS NULL THEN 'to_book' ELSE 'to_reschedule' END, error = NULL, updated_at = now()
       WHERE estimate_id = $1 AND status NOT IN ('cancelled','done','booking') RETURNING status`, [id, date]);
    return r.rowCount ? Response.json({ ok: true, status: r.rows[0].status }) : Response.json({ error: "No install to move" }, { status: 400 });
  }
  if (action === "retry") {
    const r = await db().query(
      `UPDATE installs SET status = 'to_book', error = NULL, updated_at = now() WHERE estimate_id = $1 AND status = 'failed'`, [id]);
    return r.rowCount ? Response.json({ ok: true }) : Response.json({ error: "Nothing to retry" }, { status: 400 });
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
