import { db } from "@/lib/db";
import { getSession, unauthorized } from "@/lib/session";

/** A tap (x, y as 0-1 fractions of the picture), typed text, or a key, sent to the worker's browser. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { kind?: string; x?: number; y?: number; text?: string };
  const { rows } = await db().query<{ id: number }>(`SELECT id FROM clover_login WHERE status = 'active' AND merchant_id = $1 ORDER BY id DESC LIMIT 1`, [s.merchant.id]);
  if (!rows[0]) return Response.json({ error: "No sign-in in progress" }, { status: 409 });
  if (b.kind === "click" && typeof b.x === "number" && typeof b.y === "number" && b.x >= 0 && b.x <= 1 && b.y >= 0 && b.y <= 1) {
    await db().query(`INSERT INTO clover_login_input (login_id, kind, x, y) VALUES ($1, 'click', $2, $3)`, [rows[0].id, b.x, b.y]);
  } else if (b.kind === "type" && typeof b.text === "string" && b.text.length > 0 && b.text.length <= 200) {
    await db().query(`INSERT INTO clover_login_input (login_id, kind, text) VALUES ($1, 'type', $2)`, [rows[0].id, b.text]);
  } else if (b.kind === "key" && /^(Enter|Tab|Backspace|Escape|SigninDone)$/.test(b.text ?? "")) {
    await db().query(`INSERT INTO clover_login_input (login_id, kind, text) VALUES ($1, 'key', $2)`, [rows[0].id, b.text]);
  } else {
    return Response.json({ error: "Bad input" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
