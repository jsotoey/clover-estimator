import { bookingSettings, visitIcs } from "@ce/core";
import { db } from "@/lib/db";

/**
 * The calendar file for one booked visit (public: the id is a random UUID only the customer gets).
 * Served as text/calendar so iPhones open it straight into Apple Calendar ("Add to Calendar").
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { rows } = await db().query<{ starts_at: Date; minutes: number; street: string; unit: string | null; city: string; zip: string; name: string; booking: unknown }>(
    `SELECT b.starts_at, b.minutes, b.street, b.unit, b.city, b.zip, m.name, m.booking
     FROM bookings b JOIN merchants m ON m.id = b.merchant_id WHERE b.id = $1 AND b.status <> 'cancelled'`, [id]);
  const r = rows[0];
  if (!r) return new Response("Not found", { status: 404 });
  const s = bookingSettings(r.booking);
  const ics = visitIcs({
    id, startIso: new Date(r.starts_at).toISOString(), minutes: r.minutes, storeName: r.name,
    address: `${r.street}${r.unit ? `, ${r.unit}` : ""}, ${r.city} ${r.zip}`, phone: s.phone,
  });
  return new Response(ics, {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `inline; filename="visit.ics"`, "cache-control": "private, max-age=300" },
  });
}
