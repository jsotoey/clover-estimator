import fs from "node:fs";
import path from "node:path";
import { put } from "@vercel/blob";
import { config } from "./config";

/** Save a screenshot/HTML/snapshot to Vercel Blob (or /data/artifacts if no token). Returns a URL or path. */
export async function saveArtifact(name: string, body: Buffer | string, contentType: string): Promise<string> {
  const key = `clover-worker/${new Date().toISOString().replace(/[:.]/g, "-")}-${name}`;
  if (config.blobToken) {
    const res = await put(key, body, { access: "public", contentType, token: config.blobToken, addRandomSuffix: true });
    return res.url;
  }
  const file = path.join(config.dataDir, "artifacts", key.replace(/\//g, "_"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}
