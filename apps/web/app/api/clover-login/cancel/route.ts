import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

export async function POST() {
  const s = await getSession();
  if (!s) return unauthorized();
  await db().query(`UPDATE clover_login SET status = 'cancelled', frame = NULL, finished_at = now(), updated_at = now() WHERE status IN ('requested','active') AND merchant_id = $1`, [s.merchant.id]);
  return Response.json({ ok: true });
}
