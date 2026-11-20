import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Current sign-in state + recent history (how often Clover asks us to sign in). */
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const current = await db().query(
    `SELECT id, status, reason, message, frame_at, created_at, finished_at FROM clover_login ORDER BY id DESC LIMIT 1`
  );
  const history = await db().query(
    `SELECT id, status, reason, created_at, finished_at,
            EXTRACT(EPOCH FROM (finished_at - created_at))::int AS seconds
     FROM clover_login WHERE status IN ('done','failed') ORDER BY id DESC LIMIT 20`
  );
  const waiting = await db().query<{ n: string }>(`SELECT count(*) AS n FROM estimates WHERE status = 'needs_login'`);
  return Response.json({ current: current.rows[0] ?? null, history: history.rows, waitingEstimates: Number(waiting.rows[0].n) });
}

/** Start a sign-in (reuses one already open). */
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  const open = await db().query<{ id: number }>(`SELECT id FROM clover_login WHERE status IN ('requested','active') ORDER BY id DESC LIMIT 1`);
  if (open.rows[0]) return Response.json({ id: open.rows[0].id });
  const { rows } = await db().query<{ id: number }>(`INSERT INTO clover_login (status, reason) VALUES ('requested', 'manual') RETURNING id`);
  await db().query(`INSERT INTO events (type, detail) VALUES ('login_needed', $1)`, [JSON.stringify({ loginId: rows[0].id, reason: "manual" })]);
  return Response.json({ id: rows[0].id });
}
