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

-- Paid detection (Nov 22): the worker reads Clover's invoice list and marks invoices paid.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('waiting','approved','sending','sent','failed','paid_in_person','paid'));
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sent_at timestamptz;

-- Per-store install workflow: deposit message, default material lead time, suppliers and crews.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS deposit_note text;          -- shown on the deposit invoice
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS lead_days integer NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 120);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS buffer_days integer NOT NULL DEFAULT 2 CHECK (buffer_days BETWEEN 0 AND 30);
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS book_installs boolean NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS install_service text NOT NULL DEFAULT 'Installation'; -- bookable service in Clover
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS install_time text NOT NULL DEFAULT '9:00 AM';

CREATE TABLE IF NOT EXISTS suppliers (
  id          serial PRIMARY KEY,
  merchant_id integer NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  lead_days   integer NOT NULL CHECK (lead_days BETWEEN 0 AND 120),
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (merchant_id, name)
);
CREATE TABLE IF NOT EXISTS crews (
  id          serial PRIMARY KEY,
  merchant_id integer NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name        text NOT NULL,                     -- as the employee is named in Clover ("Team 1")
  skills      text[] NOT NULL DEFAULT '{}',      -- e.g. {shower, mirror, railing}
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (merchant_id, name)
);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS supplier_id integer REFERENCES suppliers(id);

-- One install per estimate: penciled in when the deposit is paid, confirmed when materials arrive.
CREATE TABLE IF NOT EXISTS installs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id   uuid NOT NULL UNIQUE REFERENCES estimates(id) ON DELETE CASCADE,
  merchant_id   integer NOT NULL REFERENCES merchants(id),
  crew_id       integer REFERENCES crews(id),
  install_date  date NOT NULL,
  earliest_date date NOT NULL,                     -- guardrail: deposit date + supplier lead time + buffer
  status        text NOT NULL DEFAULT 'to_book'
                CHECK (status IN ('to_book','booking','tentative','to_confirm','confirmed','to_reschedule','failed','done','cancelled')),
  materials     text NOT NULL DEFAULT 'ordered' CHECK (materials IN ('none','ordered','arrived','delayed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS installs_status_idx ON installs (status, updated_at);
ALTER TABLE installs DROP CONSTRAINT IF EXISTS installs_status_check;
ALTER TABLE installs ADD CONSTRAINT installs_status_check
  CHECK (status IN ('to_book','booking','tentative','to_confirm','confirmed','to_reschedule','failed','done','cancelled'));
ALTER TABLE installs ADD COLUMN IF NOT EXISTS booked_date date;   -- the date actually in Clover's calendar

-- Online booking (Nov 23): customers book a visit (e.g. a free measure) on our page; the worker puts it
-- on the store's Clover calendar. Settings are JSON (see bookingSettings in booking.ts); null = off.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS booking jsonb;
CREATE TABLE IF NOT EXISTS bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     integer NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  starts_at       timestamptz NOT NULL,
  minutes         integer NOT NULL,
  buffer_minutes  integer NOT NULL,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text NOT NULL,
  phone           text NOT NULL,
  street          text NOT NULL,
  unit            text,
  city            text NOT NULL,
  zip             text NOT NULL,
  project_type    text NOT NULL,
  details         text NOT NULL,
  status          text NOT NULL DEFAULT 'to_book'
                  CHECK (status IN ('to_book','booking','booked','test_run','failed','cancelled')),
  error           text,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_merchant_idx ON bookings (merchant_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON bookings (status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_per_start ON bookings (merchant_id, starts_at) WHERE status <> 'cancelled';
ALTER TABLE files ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE;
-- The customer agreed (on the booking page) to texts/emails about the appointment. Clover won't save an
-- appointment for a customer with a phone until that consent is confirmed, so the bot confirms only when true.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS text_consent boolean NOT NULL DEFAULT false;

-- Who signs in where (Nov 26). The Clover login the bot uses for each store, whether the bot works that
-- store at all, and what the bot last saw there, so the app can say plainly what needs a sign-in.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS bot_email text;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS bot_paused boolean NOT NULL DEFAULT false;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS clover_signed_in boolean;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS clover_store_ok boolean;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS clover_checked_at timestamptz;
-- One row: when the bot computer last checked in, so the app can tell "bot is off" from "Clover signed out".
CREATE TABLE IF NOT EXISTS worker_heartbeat (
  id       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  seen_at  timestamptz NOT NULL DEFAULT now(),
  version  text,
  store    text
);
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
