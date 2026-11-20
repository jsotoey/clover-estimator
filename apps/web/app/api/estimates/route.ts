import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Start a new estimate conversation. */
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  const { rows } = await db().query<{ id: string }>(`INSERT INTO estimates (status) VALUES ('drafting') RETURNING id`);
  return Response.json({ id: rows[0].id });
}

/** Recent estimates for the "Recent" list (no conversation text). */
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const { rows } = await db().query(
    `SELECT id, status, error, clover_estimate_number AS number, accepted_at, updated_at,
            estimate->'customer'->>'name' AS customer, (computed->>'totalCents')::int AS total_cents
     FROM estimates WHERE estimate IS NOT NULL ORDER BY updated_at DESC LIMIT 25`
  );
  return Response.json({ estimates: rows });
}
