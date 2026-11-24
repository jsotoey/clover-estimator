import pg from "pg";
import { env } from "./env";

const g = globalThis as unknown as { __cePool?: pg.Pool };
export function db(): pg.Pool {
  if (!g.__cePool) {
    const url = env.databaseUrl();
    g.__cePool = new pg.Pool({
      connectionString: url,
      max: 3,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    });
  }
  return g.__cePool;
}

export interface EstimateRecord {
  id: string;
  status: string;
  conversation: unknown[];
  estimate: unknown | null;
  computed: unknown | null;
  clover_estimate_number: string | null;
  error: string | null;
  screenshot_urls: string[];
  photo_urls: string[];
}

export async function getEstimate(id: string): Promise<EstimateRecord | null> {
  const { rows } = await db().query<EstimateRecord>(`SELECT * FROM estimates WHERE id = $1`, [id]);
  return rows[0] ?? null;
}
