import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

/** Serves photos and worker screenshots to the signed-in merchant only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const { rows } = await db().query<{ data: Buffer; content_type: string }>(`SELECT f.data, f.content_type FROM files f LEFT JOIN estimates e ON e.id = f.estimate_id
     WHERE f.id = $1 AND (
       e.merchant_id = $2
       -- worker screenshots aren't tied to an estimate row, only listed in its screenshot_urls
       OR EXISTS (SELECT 1 FROM estimates e2 WHERE e2.merchant_id = $2 AND ('/api/files/' || f.id::text) = ANY(e2.screenshot_urls))
       OR (f.estimate_id IS NULL AND $3::boolean))`,
    [id, s.merchant.id, s.role === "admin"]);
  if (!rows[0]) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(rows[0].data), {
    headers: { "content-type": rows[0].content_type, "cache-control": "private, max-age=3600" },
  });
}
