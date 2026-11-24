import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/**
 * Merchant actions on an estimate's invoices:
 *   send      -> the worker builds it in Clover and Clover emails it (also retries a failed one)
 *   in_person -> collected on the merchant's Clover device instead; nothing is sent
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; action?: string };
  if (!["deposit", "balance"].includes(b.kind ?? "")) return Response.json({ error: "Bad kind" }, { status: 400 });
  const est = await db().query(`SELECT 1 FROM estimates WHERE id = $1 AND status = 'sent' AND coalesce(error,'') NOT LIKE 'dry run%'`, [id]);
  if (!est.rowCount) return Response.json({ error: "This estimate hasn't been sent to the customer yet" }, { status: 409 });
  let sql: string;
  if (b.action === "send") sql = `UPDATE invoices SET status = 'approved', error = NULL, updated_at = now() WHERE estimate_id = $1 AND kind = $2 AND status IN ('waiting','failed')`;
  else if (b.action === "in_person") sql = `UPDATE invoices SET status = 'paid_in_person', error = NULL, updated_at = now() WHERE estimate_id = $1 AND kind = $2 AND status IN ('waiting','failed')`;
  else return Response.json({ error: "Bad action" }, { status: 400 });
  const { rowCount } = await db().query(sql, [id, b.kind]);
  if (!rowCount) return Response.json({ error: "That invoice is already on its way or done" }, { status: 409 });
  return Response.json({ ok: true });
}
