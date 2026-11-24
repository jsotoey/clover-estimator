import { db } from "@/lib/db";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/**
 * Merchant actions on an estimate's invoices:
 *   send      -> the worker builds it in Clover and Clover emails it (also retries a failed one)
 *   in_person -> paid another way (cash, check, the Clover device); also for an invoice already emailed
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; action?: string };
  if (!["deposit", "balance"].includes(b.kind ?? "")) return Response.json({ error: "Bad kind" }, { status: 400 });
  const est = await db().query<{ accepted: boolean }>(
    `SELECT accepted_at IS NOT NULL AS accepted FROM estimates WHERE id = $1 AND status = 'sent' AND coalesce(error,'') NOT LIKE 'dry run%'`, [id]);
  if (!est.rowCount) return Response.json({ error: "This estimate hasn't been sent to the customer yet" }, { status: 409 });
  if (b.kind === "deposit" && !est.rows[0].accepted && b.action !== "undo_paid")
    return Response.json({ error: "The customer hasn't accepted yet. If they said yes in person, tap Mark accepted first." }, { status: 409 });
  let sql: string;
  if (b.action === "send") sql = `UPDATE invoices SET status = 'approved', error = NULL, updated_at = now() WHERE estimate_id = $1 AND kind = $2 AND status IN ('waiting','failed')`;
  // Paid by cash, check or on the Clover device, including after the invoice was already emailed.
  else if (b.action === "in_person") sql = `UPDATE invoices SET status = 'paid_in_person', error = NULL, updated_at = now() WHERE estimate_id = $1 AND kind = $2 AND status IN ('waiting','failed','sent')`;
  else if (b.action === "undo_paid") {
    // Back to emailed (if it was sent) or waiting. A deposit's planned install comes off too, unless it's
    // already on the Clover calendar: then the shop has to remove it there first.
    if (b.kind === "deposit") {
      const ins = await db().query<{ status: string }>(`SELECT status FROM installs WHERE estimate_id = $1`, [id]);
      const st = ins.rows[0]?.status;
      if (st && !["to_book", "failed", "to_confirm", "cancelled"].includes(st))
        return Response.json({ error: "The install is already on the Clover calendar (or being added). Remove it there first, then undo." }, { status: 409 });
      if (st) await db().query(`DELETE FROM installs WHERE estimate_id = $1`, [id]);
    }
    sql = `UPDATE invoices SET status = CASE WHEN sent_at IS NOT NULL THEN 'sent' ELSE 'waiting' END, updated_at = now()
           WHERE estimate_id = $1 AND kind = $2 AND status = 'paid_in_person'`;
  }
  else return Response.json({ error: "Bad action" }, { status: 400 });
  const { rowCount } = await db().query(sql, [id, b.kind]);
  if (!rowCount) return Response.json({ error: "That invoice is already on its way or done" }, { status: 409 });
  return Response.json({ ok: true });
}
