import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return unauthorized();
  const { id } = await ctx.params;
  const { rowCount } = await db().query(
    `UPDATE estimates SET status = 'approved', error = NULL, updated_at = now() WHERE id = $1 AND status = 'failed'`,
    [id]
  );
  if (!rowCount) return Response.json({ error: "Only a failed estimate can be retried" }, { status: 409 });
  return Response.json({ ok: true });
}
