import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/**
 * The shop marks a sent estimate as accepted itself (the customer said yes in person or by phone),
 * so the deposit can go out without waiting for them to click Accept in Clover's email.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const { rowCount } = await db().query(
    `UPDATE estimates SET accepted_at = now(), updated_at = now() WHERE id = $1 AND status = 'sent' AND accepted_at IS NULL`, [id]);
  if (!rowCount) return Response.json({ error: "This estimate is already accepted, or hasn't been sent yet." }, { status: 409 });
  await db().query(`INSERT INTO events (estimate_id, type, detail) VALUES ($1, 'accepted_by_shop', '{}')`, [id]);
  return Response.json({ ok: true });
}
