import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

/** Current sign-in state + recent history (how often Clover asks us to sign in). */
export async function GET() {
  const s = await getSession();
  if (!s) return unauthorized();
  const current = await db().query(
    `SELECT id, status, reason, message, frame_at, created_at, finished_at,
            COALESCE((to_jsonb(clover_login) ->> 'typing')::boolean, false) AS typing
     FROM clover_login WHERE merchant_id = $1 ORDER BY id DESC LIMIT 1`,
    [s.merchant.id]
  );
  const history = await db().query(
    `SELECT id, status, reason, created_at, finished_at,
            EXTRACT(EPOCH FROM (finished_at - created_at))::int AS seconds
     FROM clover_login WHERE status IN ('done','failed') AND merchant_id = $1 ORDER BY id DESC LIMIT 20`,
    [s.merchant.id]
  );
  const waiting = await db().query<{ n: string }>(`SELECT count(*) AS n FROM estimates WHERE status = 'needs_login' AND merchant_id = $1`, [s.merchant.id]);
  return Response.json({ current: current.rows[0] ?? null, history: history.rows, waitingEstimates: Number(waiting.rows[0].n) });
}

/** Start a sign-in (reuses one already open). */
export async function POST() {
  const s = await getSession();
  if (!s) return unauthorized();
  const open = await db().query<{ id: number }>(`SELECT id FROM clover_login WHERE status IN ('requested','active') AND merchant_id = $1 ORDER BY id DESC LIMIT 1`, [s.merchant.id]);
  if (open.rows[0]) return Response.json({ id: open.rows[0].id });
  const { rows } = await db().query<{ id: number }>(`INSERT INTO clover_login (status, reason, merchant_id) VALUES ('requested', 'manual', $1) RETURNING id`, [s.merchant.id]);
  await db().query(`INSERT INTO events (type, detail) VALUES ('login_needed', $1)`, [JSON.stringify({ loginId: rows[0].id, reason: "manual" })]);
  return Response.json({ id: rows[0].id });
}
