import { db } from "@/lib/db";
import { ensureMerchants, getSession, unauthorized } from "@/lib/session";

/** The signed-in store's online bookings: upcoming first, then the last two weeks. */
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  await ensureMerchants();
  const { rows } = await db().query(
    `SELECT b.id, b.starts_at, b.minutes, b.first_name, b.last_name, b.email, b.phone, b.street, b.unit, b.city, b.zip,
            b.project_type, b.details, b.status, b.error, b.created_at,
            coalesce((SELECT array_agg('/api/files/' || f.id ORDER BY f.created_at) FROM files f WHERE f.booking_id = b.id), '{}') AS photos
     FROM bookings b
     WHERE b.merchant_id = $1 AND b.starts_at > now() - interval '14 days'
     ORDER BY (b.starts_at < now()), CASE WHEN b.starts_at >= now() THEN b.starts_at END ASC, b.starts_at DESC
     LIMIT 100`, [s.merchant.id]);
  const { rows: m } = await db().query<{ slug: string; on: boolean }>(
    `SELECT slug, coalesce((booking->>'enabled')::boolean, false) AS on FROM merchants WHERE id = $1`, [s.merchant.id]);
  return Response.json({ bookings: rows, bookingUrl: m[0]?.on ? `/book/${m[0].slug}` : null });
}
