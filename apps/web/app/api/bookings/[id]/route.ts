import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

/**
 * retry   putting it on the Clover calendar failed: try again
 * cancel  free the time on the booking page (doesn't touch Clover: remove it there too if it was booked)
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  const sql =
    action === "retry" ? `UPDATE bookings SET status = 'to_book', error = NULL, updated_at = now() WHERE id = $1 AND merchant_id = $2 AND status IN ('failed','test_run') RETURNING status`
    : action === "cancel" ? `UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1 AND merchant_id = $2 AND status <> 'booking' RETURNING status`
    : null;
  if (!sql) return Response.json({ error: "Unknown action" }, { status: 400 });
  const r = await db().query(sql, [id, s.merchant.id]);
  return r.rowCount ? Response.json({ ok: true, status: r.rows[0].status }) : Response.json({ error: "That visit can't be changed right now." }, { status: 400 });
}
