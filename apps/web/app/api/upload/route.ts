import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAuthed, unauthorized } from "@/lib/auth";
import { CLOVER_LIMITS } from "@ce/core";

/** Photos arrive already converted to JPEG and compressed by the browser. */
export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const form = await req.formData();
  const id = String(form.get("estimateId") ?? "");
  const file = form.get("file");
  if (!id || !(file instanceof File)) return Response.json({ error: "Missing file" }, { status: 400 });
  if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type))
    return Response.json({ error: "Clover only takes JPG, PNG or PDF" }, { status: 400 });

  const { rows } = await db().query<{ n: number; bytes: number }>(
    `SELECT cardinality(photo_urls) AS n, 0 AS bytes FROM estimates WHERE id = $1`, [id]);
  if (!rows[0]) return Response.json({ error: "Estimate not found" }, { status: 404 });
  if (rows[0].n >= CLOVER_LIMITS.maxAttachments) return Response.json({ error: "Clover allows 3 photos max" }, { status: 400 });

  const blob = await put(`estimates/${id}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`, file, {
    access: "public",
    contentType: file.type,
    token: env.blobToken(),
    addRandomSuffix: true,
  });
  await db().query(`UPDATE estimates SET photo_urls = array_append(photo_urls, $2), updated_at = now() WHERE id = $1`, [id, blob.url]);
  return Response.json({ url: blob.url });
}
