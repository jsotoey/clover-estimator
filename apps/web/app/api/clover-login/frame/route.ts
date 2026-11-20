import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Latest picture of the worker's browser during a sign-in. */
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const { rows } = await db().query<{ frame: Buffer | null }>(
    `SELECT frame FROM clover_login WHERE status = 'active' ORDER BY id DESC LIMIT 1`
  );
  if (!rows[0]?.frame) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(rows[0].frame), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
}
