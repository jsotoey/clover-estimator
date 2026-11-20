import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  await db().query(`UPDATE clover_login SET status = 'cancelled', frame = NULL, finished_at = now(), updated_at = now() WHERE status IN ('requested','active')`);
  return Response.json({ ok: true });
}
