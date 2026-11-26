import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

/** Set which Clover login the bot uses for this store (just the email, never a password), or pause the bot for it. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { botEmail?: string | null; paused?: boolean };
  if (b.botEmail !== undefined) {
    const e = (b.botEmail ?? "").trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return Response.json({ error: "That doesn't look like an email." }, { status: 400 });
    await db().query(`UPDATE merchants SET bot_email = $2 WHERE id = $1`, [s.merchant.id, e || null]);
  }
  if (typeof b.paused === "boolean") {
    await db().query(`UPDATE merchants SET bot_paused = $2 WHERE id = $1`, [s.merchant.id, b.paused]);
  }
  return Response.json({ ok: true });
}
