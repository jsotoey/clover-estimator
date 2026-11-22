import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

/** Start a new estimate conversation. */
export async function POST() {
  const s = await getSession();
  if (!s) return unauthorized();
  const { rows } = await db().query<{ id: string }>(`INSERT INTO estimates (status, merchant_id) VALUES ('drafting', $1) RETURNING id`, [s.merchant.id]);
  return Response.json({ id: rows[0].id });
}

/** Recent estimates for the "Recent" list (no conversation text). */
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const { rows } = await db().query(
    `SELECT e.id, e.status, e.error, e.clover_estimate_number AS number, e.accepted_at, e.updated_at,
            e.estimate->'customer'->>'name' AS customer, (e.computed->>'totalCents')::int AS total_cents,
            COALESCE((SELECT json_agg(json_build_object('kind', i.kind, 'status', i.status))
                      FROM invoices i WHERE i.estimate_id = e.id), '[]'::json) AS invoices
     FROM estimates e WHERE e.estimate IS NOT NULL AND e.merchant_id = $1 ORDER BY e.updated_at DESC LIMIT 40`,
    [s.merchant.id]
  );
  return Response.json({ estimates: rows });
}
