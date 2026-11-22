import { credentialEnvNames, slugify } from "@ce/core";
import { db } from "@/lib/db";
import { getSession, listMerchants, pinHash, unauthorized } from "@/lib/session";

/** Admin only: every store, with what the laptop needs to sign it in. */
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "admin") return unauthorized();
  const stores = await listMerchants();
  const signedIn = await db().query<{ merchant_id: number; finished_at: string }>(
    `SELECT DISTINCT ON (merchant_id) merchant_id, finished_at FROM clover_login WHERE status = 'done' ORDER BY merchant_id, id DESC`
  );
  const last = new Map(signedIn.rows.map((r) => [r.merchant_id, r.finished_at]));
  return Response.json({
    current: s.merchant.id,
    stores: stores.map((m, i) => ({ ...m, lastSignIn: last.get(m.id) ?? null, env: i === 0 ? null : credentialEnvNames(m.slug) })),
  });
}

/** Admin only: add a store. Clover passwords are never stored here: they go in the laptop's settings file. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "admin") return unauthorized();
  const b = (await req.json().catch(() => ({}))) as {
    name?: string; cloverName?: string; taxRate?: number; depositPercent?: number; validDays?: number;
    taxable?: boolean; paymentProgram?: string; pin?: string;
  };
  const name = (b.name ?? "").trim();
  if (name.length < 2 || name.length > 80) return Response.json({ error: "Enter the store's name" }, { status: 400 });
  const tax = Number(b.taxRate);
  if (!(tax >= 0 && tax < 25)) return Response.json({ error: "Sales tax looks wrong (enter it like 6.625)" }, { status: 400 });
  const pin = (b.pin ?? "").trim();
  if (pin && !/^\d{4,8}$/.test(pin)) return Response.json({ error: "PIN must be 4 to 8 digits" }, { status: 400 });
  if (pin) {
    const clash = await db().query(`SELECT 1 FROM merchants WHERE pin_hash = $1`, [pinHash(pin)]);
    if (clash.rowCount || (process.env.ADMIN_PIN && pin === process.env.ADMIN_PIN.trim()))
      return Response.json({ error: "That PIN is already used. Pick another one." }, { status: 400 });
  }
  const program = ["none", "surcharge", "cash_discount"].includes(b.paymentProgram ?? "") ? b.paymentProgram : "none";
  let slug = slugify(name);
  for (let i = 2; (await db().query(`SELECT 1 FROM merchants WHERE slug = $1`, [slug])).rowCount; i++) slug = `${slugify(name).slice(0, 28)}-${i}`;
  const { rows } = await db().query<{ id: number }>(
    `INSERT INTO merchants (slug, name, clover_name, tax_rate, deposit_percent, valid_days, taxable, payment_program, pin_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [slug, name, (b.cloverName ?? "").trim() || name, +(tax / 100).toFixed(5),
     Math.min(100, Math.max(0, Math.round(b.depositPercent ?? 50))), Math.min(29, Math.max(1, Math.round(b.validDays ?? 29))),
     b.taxable !== false, program, pin ? pinHash(pin) : null]
  );
  return Response.json({ id: rows[0].id, slug, env: credentialEnvNames(slug) });
}
