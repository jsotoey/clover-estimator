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
  // Who's who: the bot computer, and the Clover login it uses for this store.
  const m = await db().query(
    `SELECT name, clover_name, to_jsonb(m) ->> 'bot_email' AS bot_email,
            COALESCE((to_jsonb(m) ->> 'bot_paused')::boolean, false) AS bot_paused,
            (to_jsonb(m) ->> 'clover_signed_in')::boolean AS signed_in,
            (to_jsonb(m) ->> 'clover_store_ok')::boolean AS store_ok,
            to_jsonb(m) ->> 'clover_checked_at' AS checked_at
     FROM merchants m WHERE id = $1`, [s.merchant.id]);
  const beat = await db().query<{ seen_at: string; store: string | null }>(`SELECT seen_at, store FROM worker_heartbeat WHERE id = 1`).catch(() => ({ rows: [] as { seen_at: string; store: string | null }[] }));
  const seen = beat.rows[0]?.seen_at ?? null;
  // While a sign-in is open the bot is busy with it and doesn't check in, but it's running.
  const online = current.rows[0]?.status === "active" || (!!seen && Date.now() - new Date(seen).getTime() < 6 * 60_000);
  return Response.json({
    current: current.rows[0] ?? null, history: history.rows, waitingEstimates: Number(waiting.rows[0].n),
    bot: { online, seenAt: seen, known: !!seen },
    store: m.rows[0] ? {
      name: m.rows[0].name, cloverName: m.rows[0].clover_name, botEmail: m.rows[0].bot_email, paused: m.rows[0].bot_paused,
      signedIn: m.rows[0].signed_in, storeOk: m.rows[0].store_ok, checkedAt: m.rows[0].checked_at,
    } : null,
  });
}

/** Start a sign-in (reuses one already open). */
/** Start a Clover sign-in. { switch: true } makes the bot forget its current Clover login first (e.g. moving to a bot login). */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const reason = ((await req.json().catch(() => ({}))) as { switch?: boolean }).switch ? "switch" : "manual";
  const open = await db().query<{ id: number }>(`SELECT id FROM clover_login WHERE status IN ('requested','active') AND merchant_id = $1 ORDER BY id DESC LIMIT 1`, [s.merchant.id]);
  if (open.rows[0]) return Response.json({ id: open.rows[0].id });
  const { rows } = await db().query<{ id: number }>(`INSERT INTO clover_login (status, reason, merchant_id) VALUES ('requested', $2, $1) RETURNING id`, [s.merchant.id, reason]);
  await db().query(`INSERT INTO events (type, detail) VALUES ('login_needed', $1)`, [JSON.stringify({ loginId: rows[0].id, reason })]);
  return Response.json({ id: rows[0].id });
}
