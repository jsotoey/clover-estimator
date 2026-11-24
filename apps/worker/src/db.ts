import pg from "pg";
import { config } from "./config";

let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  if (!pool) {
    const url = config.databaseUrl();
    pool = new pg.Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1|railway\.internal/.test(url) ? false : { rejectUnauthorized: false } });
  }
  return pool;
}

export interface EstimateRow {
  id: string;
  status: string;
  estimate: unknown;
  computed: unknown;
  photo_urls: string[];
  merchant_id: number;
}

/** Claim one approved estimate atomically. */
export async function claimNext(): Promise<EstimateRow | null> {
  const { rows } = await db().query<EstimateRow>(
    `UPDATE estimates SET status = 'sending', updated_at = now()
     WHERE id = (SELECT id FROM estimates WHERE status = 'approved' AND merchant_id IS NOT NULL
                 ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, status, estimate, computed, photo_urls, merchant_id`
  );
  return rows[0] ?? null;
}

export async function setStatus(id: string, status: string, fields: { error?: string; cloverNumber?: string } = {}) {
  await db().query(
    `UPDATE estimates SET status = $2, error = COALESCE($3, error),
       clover_estimate_number = COALESCE($4, clover_estimate_number), updated_at = now() WHERE id = $1`,
    [id, status, fields.error ?? null, fields.cloverNumber ?? null]
  );
}

export async function addScreenshot(id: string, url: string) {
  await db().query(`UPDATE estimates SET screenshot_urls = array_append(screenshot_urls, $2), updated_at = now() WHERE id = $1`, [id, url]);
}

export async function logEvent(estimateId: string | null, type: string, detail: Record<string, unknown> = {}) {
  console.log(`[event] ${type}`, JSON.stringify(detail));
  try {
    await db().query(`INSERT INTO events (estimate_id, type, detail) VALUES ($1, $2, $3)`, [estimateId, type, detail]);
  } catch (e) {
    console.error("logEvent failed", e);
  }
}

/** Wait for the merchant to type a Clover verification code into the app. */
export async function waitForCode(estimateId: string | null, sinceIso: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await db().query<{ id: number; code: string }>(
      `SELECT id, code FROM verification_codes
       WHERE used_at IS NULL AND created_at >= $1 AND ($2::uuid IS NULL OR estimate_id = $2 OR estimate_id IS NULL)
       ORDER BY created_at DESC LIMIT 1`,
      [sinceIso, estimateId]
    );
    if (rows[0]) {
      await db().query(`UPDATE verification_codes SET used_at = now() WHERE id = $1`, [rows[0].id]);
      return rows[0].code.trim();
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}
