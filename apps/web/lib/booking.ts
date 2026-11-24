import { bookingSettings, type BookingSettings, type Busy } from "@ce/core";
import type { Pool, PoolClient } from "pg";
import { db } from "@/lib/db";
import { ensureMerchants } from "@/lib/session";

export interface BookingStore { id: number; slug: string; name: string; settings: BookingSettings }

/** A store that takes online bookings, by its public slug (null if unknown or switched off). */
export async function bookingStore(slug: string): Promise<BookingStore | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(slug)) return null;
  await ensureMerchants();
  const { rows } = await db().query<{ id: number; slug: string; name: string; booking: unknown }>(
    `SELECT id, slug, name, booking FROM merchants WHERE slug = $1 AND active`, [slug]);
  if (!rows[0]) return null;
  const settings = bookingSettings(rows[0].booking);
  return settings.enabled ? { id: rows[0].id, slug: rows[0].slug, name: rows[0].name, settings } : null;
}

/** Visits already on the books (anything not cancelled keeps its time), for the slot math. */
export async function busyTimes(merchantId: number, run: Pool | PoolClient = db(), exceptId: string | null = null): Promise<Busy[]> {
  const { rows } = await run.query<{ starts_at: Date; minutes: number; buffer_minutes: number }>(
    `SELECT starts_at, minutes, buffer_minutes FROM bookings
     WHERE merchant_id = $1 AND status <> 'cancelled' AND starts_at > now() - interval '1 day' AND starts_at < now() + interval '90 days'
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [merchantId, exceptId]);
  return rows.map((r) => ({ start: new Date(r.starts_at).getTime(), minutes: r.minutes, bufferMinutes: r.buffer_minutes }));
}
