import { bookingSettings, openSlots, zonedClock, zonedInstant } from "@ce/core";
import { db } from "@/lib/db";
import { busyTimes } from "@/lib/booking";
import { getSession, unauthorized } from "@/lib/session";

const ID = /^[0-9a-f-]{36}$/i;

async function storeSettings(merchantId: number) {
  const { rows } = await db().query<{ booking: unknown }>(`SELECT booking FROM merchants WHERE id = $1`, [merchantId]);
  return bookingSettings(rows[0]?.booking);
}

/** Open times to move this visit to (the shop's booking rules, but bookable from 1 hour out). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const settings = { ...(await storeSettings(s.merchant.id)), noticeHours: 1 };
  const days = openSlots(settings, Date.now(), await busyTimes(s.merchant.id, db(), id));
  return Response.json({ days, timeZone: settings.timeZone }, { headers: { "cache-control": "no-store" } });
}

/**
 * retry       putting it on the Clover calendar failed: try again
 * cancel      free the time on the booking page (doesn't touch Clover: remove it there too if it was booked)
 * reschedule  move it to { start } (ISO) or { date: "YYYY-MM-DD", time: "HH:MM" } in the store's time zone.
 *             The shop can pick any time; it only has to not overlap another visit. A visit already on the
 *             Clover calendar has to be moved there too (the customer gets Clover's update from that).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; start?: string; date?: string; time?: string };
  const { action } = body;

  if (action === "reschedule") {
    const settings = await storeSettings(s.merchant.id);
    let start = body.start ? Date.parse(body.start) : NaN;
    if (Number.isNaN(start) && body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && body.time && /^\d{2}:\d{2}$/.test(body.time))
      start = zonedInstant(body.date, body.time, settings.timeZone);
    if (Number.isNaN(start)) return Response.json({ error: "Pick a new day and time." }, { status: 400 });
    if (start < Date.now()) return Response.json({ error: "That time has already passed." }, { status: 400 });

    const client = await db().connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(91000000 + $1)`, [s.merchant.id]);
      const { rows } = await client.query<{ status: string; minutes: number; buffer_minutes: number }>(
        `SELECT status, minutes, buffer_minutes FROM bookings WHERE id = $1 AND merchant_id = $2 FOR UPDATE`, [id, s.merchant.id]);
      const v = rows[0];
      if (!v || v.status === "cancelled" || v.status === "booking") {
        await client.query("ROLLBACK");
        return Response.json({ error: "That visit can't be moved right now." }, { status: 400 });
      }
      const end = start + (v.minutes + v.buffer_minutes) * 60_000;
      const clash = (await busyTimes(s.merchant.id, client, id)).some((b) => start < b.start + (b.minutes + b.bufferMinutes) * 60_000 && b.start < end);
      if (clash) {
        await client.query("ROLLBACK");
        return Response.json({ error: "That time overlaps another visit (including drive time). Pick another." }, { status: 409 });
      }
      const onClover = v.status === "booked";
      await client.query(
        `UPDATE bookings SET starts_at = $3, updated_at = now(), error = $4 WHERE id = $1 AND merchant_id = $2`,
        [id, s.merchant.id, new Date(start).toISOString(),
         onClover ? "Moved in the app. Move it on the Clover calendar too, so the customer gets the new time." : null]);
      await client.query("COMMIT");
      return Response.json({ ok: true, onClover, label: zonedClock(start, settings.timeZone) });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      if ((e as { code?: string }).code === "23505") return Response.json({ error: "Another visit starts at that exact time." }, { status: 409 });
      throw e;
    } finally {
      client.release();
    }
  }

  const sql =
    action === "retry" ? `UPDATE bookings SET status = 'to_book', error = NULL, updated_at = now() WHERE id = $1 AND merchant_id = $2 AND status IN ('failed','test_run') RETURNING status`
    : action === "cancel" ? `UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1 AND merchant_id = $2 AND status <> 'booking' RETURNING status`
    : null;
  if (!sql) return Response.json({ error: "Unknown action" }, { status: 400 });
  const r = await db().query(sql, [id, s.merchant.id]);
  return r.rowCount ? Response.json({ ok: true, status: r.rows[0].status }) : Response.json({ error: "That visit can't be changed right now." }, { status: 400 });
}
