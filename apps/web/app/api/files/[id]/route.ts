import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Serves photos and worker screenshots to the signed-in merchant only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return unauthorized();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { rows } = await db().query<{ data: Buffer; content_type: string }>(`SELECT data, content_type FROM files WHERE id = $1`, [id]);
  if (!rows[0]) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(rows[0].data), {
    headers: { "content-type": rows[0].content_type, "cache-control": "private, max-age=3600" },
  });
}
