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
     LIMIT 300`, [s.merchant.id]);
  const { rows: m } = await db().query<{ slug: string; on: boolean }>(
    `SELECT slug, coalesce((booking->>'enabled')::boolean, false) AS on FROM merchants WHERE id = $1`, [s.merchant.id]);
  // Installs booked from accepted estimates, so the calendar shows the whole week's work.
  const { rows: installs } = await db().query(
    `SELECT i.id, i.estimate_id, i.install_date::text AS date, i.status, c.name AS crew, mm.install_time AS time,
            e.estimate->'customer'->>'name' AS customer, e.estimate->'customer'->>'job_address' AS address
     FROM installs i JOIN estimates e ON e.id = i.estimate_id LEFT JOIN crews c ON c.id = i.crew_id JOIN merchants mm ON mm.id = i.merchant_id
     WHERE i.merchant_id = $1 AND i.install_date >= (now() AT TIME ZONE 'America/New_York')::date - 14
     ORDER BY i.install_date LIMIT 200`, [s.merchant.id]);
  return Response.json({ bookings: rows, installs, bookingUrl: m[0]?.on ? `/book/${m[0].slug}` : null });
}
