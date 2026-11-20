import { db } from "@/lib/db";
import { isAuthed, unauthorized } from "@/lib/auth";

/** Clover verification code typed by the merchant; the worker picks it up. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthed())) return unauthorized();
  const { id } = await ctx.params;
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  const clean = String(code ?? "").replace(/\s/g, "");
  if (!/^[0-9A-Za-z]{4,10}$/.test(clean)) return Response.json({ error: "Enter the code from Clover" }, { status: 400 });
  await db().query(`INSERT INTO verification_codes (estimate_id, code) VALUES ($1, $2)`, [id, clean]);
  return Response.json({ ok: true });
}
