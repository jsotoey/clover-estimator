import { db, getEstimate } from "@/lib/db";
import { splitInvoices, type Estimate, type PricingResult } from "@ce/core";
import { getSession, unauthorized, ownsEstimate } from "@/lib/session";

/** Status for the review card / banner. Conversation is not returned. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return unauthorized();
  const { id } = await ctx.params;
  if (!(await ownsEstimate(s, id))) return Response.json({ error: "Not found" }, { status: 404 });
  const e = await getEstimate(id);
  if (!e) return Response.json({ error: "Not found" }, { status: 404 });
  // While a Clover sign-in is open, the worker is busy with it; say so instead of "putting it into Clover".
  const login = await db().query(`SELECT 1 FROM clover_login WHERE status IN ('requested','active') AND merchant_id = $1 LIMIT 1`, [s.merchant.id]);
  // A really-sent estimate gets its deposit/balance invoices (amounts from the shared pricing code).
  const sentForReal = e.status === "sent" && !(e.error ?? "").startsWith("dry run");
  if (sentForReal && e.estimate && e.computed) {
    const est = e.estimate as Estimate;
    const split = splitInvoices((e.computed as PricingResult).subtotalCents, s.merchant.taxRate, est.taxable, est.deposit_percent);
    for (const [kind, p] of [["deposit", split.deposit], ["balance", split.balance]] as const) {
      if (!p) continue;
      await db().query(
        `INSERT INTO invoices (estimate_id, kind, subtotal_cents, tax_cents, total_cents) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (estimate_id, kind) DO NOTHING`,
        [id, kind, p.subtotalCents, p.taxCents, p.totalCents]
      );
    }
  }
  const inv = sentForReal
    ? (await db().query(
        `SELECT kind, status, total_cents, pay_link, error, clover_invoice_number, updated_at FROM invoices WHERE estimate_id = $1 ORDER BY kind DESC`, [id]
      )).rows.map((r) => ({ kind: r.kind, status: r.status, totalCents: r.total_cents, payLink: r.pay_link, error: r.error, number: r.clover_invoice_number, updatedAt: r.updated_at }))
    : [];
  const meta = await db().query<{ accepted_at: string | null; sent_at: string | null }>(`SELECT accepted_at, sent_at FROM estimates WHERE id = $1`, [id]);
  return Response.json({
    sentForReal,
    acceptedAt: meta.rows[0]?.accepted_at ?? null,
    sentAt: meta.rows[0]?.sent_at ?? null,
    invoices: inv,
    signInOpen: login.rowCount! > 0,
    id: e.id,
    status: e.status,
    estimate: e.estimate,
    computed: e.computed,
    cloverEstimateNumber: e.clover_estimate_number,
    error: e.error,
    screenshots: e.screenshot_urls,
    photos: e.photo_urls,
  });
}
