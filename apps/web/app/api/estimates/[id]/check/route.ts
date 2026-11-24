import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/** "Check now": ask the bot to look at Clover right away for an acceptance or a payment. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  // At most one request every 20 seconds per estimate, so repeated taps don't pile up.
  await db().query(
    `INSERT INTO events (estimate_id, type, detail) SELECT $1, 'check_now', '{}'
     WHERE NOT EXISTS (SELECT 1 FROM events WHERE estimate_id = $1 AND type = 'check_now' AND created_at > now() - interval '20 seconds')`, [id]);
  return Response.json({ ok: true });
}
