import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const { rowCount } = await db().query(
    `UPDATE estimates SET status = 'approved', error = NULL, updated_at = now() WHERE id = $1 AND status = 'failed'`,
    [id]
  );
  if (!rowCount) return Response.json({ error: "Only a failed estimate can be retried" }, { status: 409 });
  return Response.json({ ok: true });
}
