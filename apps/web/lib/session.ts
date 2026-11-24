import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { MERCHANTS_SQL, BACKFILL_SQL, slugify, type PaymentProgram } from "@ce/core";
import { db } from "./db";
import { env } from "./env";

/**
 * Who is using the app, and for which store.
 *  - store: a store owner (their PIN), sees only their store
 *  - admin: Jon (ADMIN_PIN), can switch between stores and add new ones
 */
export interface Merchant {
  id: number; slug: string; name: string; cloverName: string;
  taxRate: number; depositPercent: number; validDays: number; taxable: boolean; paymentProgram: PaymentProgram;
}
export interface Session { role: "admin" | "store"; merchant: Merchant }

export const SESSION_COOKIE = "ce_session";
const LEGACY_COOKIE = "ce_auth"; // single-store cookie from before; still accepted for the first store

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const pinHash = (pin: string) => sha(`pin:${pin.trim()}`);
const secret = () => process.env.SESSION_SECRET || sha(`ce-session|${process.env.MERCHANT_PIN ?? ""}|${env.databaseUrl()}`);
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function sessionCookieValue(role: Session["role"], merchantId: number): string {
  const payload = Buffer.from(JSON.stringify({ r: role, m: merchantId })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookie(v: string): { r: Session["role"]; m: number } | null {
  const [payload, sig] = v.split(".");
  if (!payload || !sig) return null;
  const good = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString());
    return (j.r === "admin" || j.r === "store") && Number.isInteger(j.m) ? j : null;
  } catch { return null; }
}

export const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production" && !process.env.LOCAL_HTTP,
  sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 90,
};

// ---------- stores ----------
type Row = { id: number; slug: string; name: string; clover_name: string | null; tax_rate: string; deposit_percent: number; valid_days: number; taxable: boolean; payment_program: PaymentProgram };
const toMerchant = (r: Row): Merchant => ({
  id: r.id, slug: r.slug, name: r.name, cloverName: r.clover_name || r.name, taxRate: Number(r.tax_rate),
  depositPercent: r.deposit_percent, validDays: r.valid_days, taxable: r.taxable, paymentProgram: r.payment_program,
});

const g = globalThis as unknown as { __ceMerchantsReady?: Promise<void> };
/** Creates the stores table if needed and, the first time, turns the single-store setup into store #1. */
export function ensureMerchants(): Promise<void> {
  g.__ceMerchantsReady ??= (async () => {
    await db().query(MERCHANTS_SQL);
    const { rows } = await db().query(`SELECT 1 FROM merchants LIMIT 1`);
    if (!rows.length && process.env.MERCHANT_TAX_RATE) {
      const t = env.terms();
      const name = env.businessName() || "My business";
      await db().query(
        `INSERT INTO merchants (slug, name, clover_name, tax_rate, deposit_percent, valid_days, taxable, payment_program, pin_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
        [slugify(name), name, env.businessName() || null, env.taxRate(), t.depositPercent, t.validDays, t.taxable, env.paymentProgram(),
         process.env.MERCHANT_PIN ? pinHash(process.env.MERCHANT_PIN) : null]
      );
    }
    await db().query(BACKFILL_SQL);
  })().catch((e) => { g.__ceMerchantsReady = undefined; throw e; });
  return g.__ceMerchantsReady;
}

export async function getMerchant(id: number): Promise<Merchant | null> {
  await ensureMerchants();
  const { rows } = await db().query<Row>(`SELECT * FROM merchants WHERE id = $1 AND active`, [id]);
  return rows[0] ? toMerchant(rows[0]) : null;
}

export async function listMerchants(): Promise<Merchant[]> {
  await ensureMerchants();
  const { rows } = await db().query<Row>(`SELECT * FROM merchants WHERE active ORDER BY id`);
  return rows.map(toMerchant);
}

/** The PIN decides who you are: the admin PIN, or one store's PIN. */
export async function signInWithPin(pin: string): Promise<Session | null> {
  await ensureMerchants();
  const clean = pin.trim();
  if (!clean) return null;
  const admin = process.env.ADMIN_PIN;
  if (admin && sha(clean) === sha(admin.trim())) {
    const first = (await listMerchants())[0];
    return first ? { role: "admin", merchant: first } : null;
  }
  const { rows } = await db().query<Row>(`SELECT * FROM merchants WHERE active AND pin_hash = $1 ORDER BY id LIMIT 1`, [pinHash(clean)]);
  return rows[0] ? { role: "store", merchant: toMerchant(rows[0]) } : null;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const v = jar.get(SESSION_COOKIE)?.value;
  if (v) {
    const c = readCookie(v);
    if (!c) return null;
    const m = await getMerchant(c.m);
    return m ? { role: c.r, merchant: m } : null;
  }
  // Phones signed in before stores existed: the old cookie was a hash of MERCHANT_PIN.
  const legacy = jar.get(LEGACY_COOKIE)?.value;
  if (legacy && process.env.MERCHANT_PIN && legacy === sha(`ce:${process.env.MERCHANT_PIN}`)) {
    const first = (await listMerchants())[0];
    return first ? { role: "store", merchant: first } : null;
  }
  return null;
}

export function unauthorized() {
  return Response.json({ error: "Not signed in" }, { status: 401 });
}

/** True when this estimate belongs to the session's store. */
export async function ownsEstimate(s: Session, estimateId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(estimateId)) return false;
  const { rowCount } = await db().query(`SELECT 1 FROM estimates WHERE id = $1 AND merchant_id = $2`, [estimateId, s.merchant.id]);
  return !!rowCount;
}
