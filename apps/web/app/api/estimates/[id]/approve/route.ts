import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/** The merchant's explicit approval. Only a reviewed estimate can be queued for the worker. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const { rowCount } = await db().query(
    `UPDATE estimates SET status = 'approved', updated_at = now() WHERE id = $1 AND status IN ('ready_for_review','drafting') AND estimate IS NOT NULL AND computed IS NOT NULL`,
    [id]
  );
  if (!rowCount) return Response.json({ error: "Nothing to approve (already sent, or still drafting)" }, { status: 409 });
  await db().query(`INSERT INTO events (estimate_id, type) VALUES ($1, 'approved')`, [id]);
  return Response.json({ ok: true });
}
