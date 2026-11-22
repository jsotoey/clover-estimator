/**
 * Multi-store support. Shared by the web app and the worker so either can create the tables first
 * (Railway may deploy the web app before the laptop worker updates). Idempotent.
 */
export const MERCHANTS_SQL = `
CREATE TABLE IF NOT EXISTS merchants (
  id               serial PRIMARY KEY,
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,30}$'),
  name             text NOT NULL,
  clover_name      text,                 -- store name as Clover shows it (the worker checks it's in the right store)
  tax_rate         numeric(6,5) NOT NULL CHECK (tax_rate >= 0 AND tax_rate < 0.25),
  deposit_percent  integer NOT NULL DEFAULT 50 CHECK (deposit_percent BETWEEN 0 AND 100),
  valid_days       integer NOT NULL DEFAULT 29 CHECK (valid_days BETWEEN 1 AND 29),
  taxable          boolean NOT NULL DEFAULT true,
  payment_program  text NOT NULL DEFAULT 'none' CHECK (payment_program IN ('none','surcharge','cash_discount')),
  pin_hash         text,                 -- sha256 of the store owner's PIN (null = only the admin can open it)
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE estimates    ADD COLUMN IF NOT EXISTS merchant_id integer REFERENCES merchants(id);
ALTER TABLE clover_login ADD COLUMN IF NOT EXISTS merchant_id integer REFERENCES merchants(id);
ALTER TABLE worker_tasks ADD COLUMN IF NOT EXISTS merchant_id integer REFERENCES merchants(id);
CREATE INDEX IF NOT EXISTS estimates_merchant_idx ON estimates (merchant_id, updated_at);
`;

/** Rows created before multi-store support belong to the first store. */
export const BACKFILL_SQL = `
UPDATE estimates    SET merchant_id = (SELECT min(id) FROM merchants) WHERE merchant_id IS NULL AND EXISTS (SELECT 1 FROM merchants);
UPDATE clover_login SET merchant_id = (SELECT min(id) FROM merchants) WHERE merchant_id IS NULL AND EXISTS (SELECT 1 FROM merchants);
UPDATE worker_tasks SET merchant_id = (SELECT min(id) FROM merchants) WHERE merchant_id IS NULL AND EXISTS (SELECT 1 FROM merchants);
`;

export interface MerchantRow {
  id: number; slug: string; name: string; clover_name: string | null; tax_rate: string | number;
  deposit_percent: number; valid_days: number; taxable: boolean; payment_program: string; active: boolean;
}

/** Laptop env var names for a store's Clover login: CLOVER_EMAIL_DEMO_STORE / CLOVER_PASSWORD_DEMO_STORE. */
export function credentialEnvNames(slug: string) {
  const key = slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return { email: `CLOVER_EMAIL_${key}`, password: `CLOVER_PASSWORD_${key}` };
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 31) || "store";
}
