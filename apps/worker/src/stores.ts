import path from "node:path";
import { credentialEnvNames } from "@ce/core";
import { config } from "./config";
import { db } from "./db";

/**
 * The stores this worker serves (rows in `merchants`). One store at a time is "active": its own Chrome
 * profile and saved sign-in are what the browser uses. The first store keeps the original folders and
 * the plain CLOVER_EMAIL / CLOVER_PASSWORD, so the existing setup keeps working unchanged.
 */
export interface Store {
  id: number; slug: string; name: string; cloverName: string; taxRate: number;
  primary: boolean; dataDir: string; email?: string; password?: string;
}

let cache: { at: number; stores: Store[] } | null = null;
export async function loadStores(force = false): Promise<Store[]> {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.stores;
  const { rows } = await db().query<{ id: number; slug: string; name: string; clover_name: string | null; tax_rate: string; primary_id: number }>(
    `SELECT id, slug, name, clover_name, tax_rate, (SELECT min(id) FROM merchants) AS primary_id FROM merchants WHERE active ORDER BY id`
  ).catch(() => ({ rows: [] as never[] }));
  const stores = rows.map((r) => {
    const primary = r.id === r.primary_id;
    const env = credentialEnvNames(r.slug);
    return {
      id: r.id, slug: r.slug, name: r.name, cloverName: r.clover_name || r.name, taxRate: Number(r.tax_rate), primary,
      dataDir: primary ? config.dataDir : path.join(config.dataDir, "stores", r.slug),
      email: process.env[env.email] ?? (primary ? process.env.CLOVER_EMAIL : undefined),
      password: process.env[env.password] ?? (primary ? process.env.CLOVER_PASSWORD : undefined),
    };
  });
  cache = { at: Date.now(), stores };
  return stores;
}

export async function storeById(id: number | null | undefined): Promise<Store | null> {
  if (id == null) return null;
  return (await loadStores()).find((s) => s.id === id) ?? (await loadStores(true)).find((s) => s.id === id) ?? null;
}

let active: Store | null = null;
export function activeStore(): Store {
  if (!active) throw new Error("No store selected");
  return active;
}
export function setActiveStore(s: Store) { active = s; }
export function activeStoreOrNull(): Store | null { return active; }

/** Last known Clover sign-in state per store (undefined = not checked yet). */
export const signedIn = new Map<number, boolean>();
