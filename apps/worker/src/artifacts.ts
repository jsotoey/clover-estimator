import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { db } from "./db";

/**
 * Saves a screenshot / HTML / ARIA snapshot into the files table and returns its app path
 * (/api/files/<id>), which the web app serves to a signed-in merchant.
 * Falls back to /data/artifacts if the database write fails.
 */
export async function saveArtifact(name: string, body: Buffer | string, contentType: string, estimateId: string | null = null): Promise<string> {
  const buf = typeof body === "string" ? Buffer.from(body) : body;
  const kind = contentType.startsWith("image/") ? "screenshot" : "text";
  try {
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO files (estimate_id, kind, name, content_type, data) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [estimateId, kind, name, contentType, buf]
    );
    return `/api/files/${rows[0].id}`;
  } catch (e) {
    console.error("saveArtifact db write failed, saving locally", e);
    const file = path.join(config.dataDir, "artifacts", `${Date.now()}-${name}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return file;
  }
}

/** Load a photo the web app stored (photo_urls hold /api/files/<id>). */
export async function loadFile(appPath: string): Promise<{ data: Buffer; name: string } | null> {
  const id = appPath.match(/\/api\/files\/([0-9a-f-]{36})/i)?.[1];
  if (!id) return null;
  const { rows } = await db().query<{ data: Buffer; name: string }>(`SELECT data, name FROM files WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
