import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";
import { CLOVER_LIMITS } from "@ce/core";

/** Photos arrive already converted to JPEG and compressed by the browser; stored in Postgres. */
export async function POST(req: Request) {
  if (!(await isAuthed())) return unauthorized();
  const form = await req.formData();
  const id = String(form.get("estimateId") ?? "");
  const file = form.get("file");
  if (!id || !(file instanceof File)) return Response.json({ error: "Missing file" }, { status: 400 });
  if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type))
    return Response.json({ error: "Clover only takes JPG, PNG or PDF" }, { status: 400 });

  const { rows } = await db().query<{ n: number; bytes: string }>(
    `SELECT cardinality(e.photo_urls) AS n,
            COALESCE((SELECT sum(octet_length(data)) FROM files f WHERE f.estimate_id = e.id AND f.kind = 'photo'), 0) AS bytes
     FROM estimates e WHERE e.id = $1`, [id]);
  if (!rows[0]) return Response.json({ error: "Estimate not found" }, { status: 404 });
  if (rows[0].n >= CLOVER_LIMITS.maxAttachments) return Response.json({ error: "Clover allows 3 photos max" }, { status: 400 });
  if (Number(rows[0].bytes) + file.size > CLOVER_LIMITS.maxAttachmentBytes)
    return Response.json({ error: "Photos are over Clover's 25 MB limit" }, { status: 400 });

  const data = Buffer.from(await file.arrayBuffer());
  const ins = await db().query<{ id: string }>(
    `INSERT INTO files (estimate_id, kind, name, content_type, data) VALUES ($1, 'photo', $2, $3, $4) RETURNING id`,
    [id, file.name.replace(/[^\w.-]/g, "_"), file.type, data]
  );
  const url = `/api/files/${ins.rows[0].id}`;
  await db().query(`UPDATE estimates SET photo_urls = array_append(photo_urls, $2), updated_at = now() WHERE id = $1`, [id, url]);
  return Response.json({ url });
}
