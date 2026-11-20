-- Idempotent: safe to run on every deploy.
CREATE TABLE IF NOT EXISTS estimates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status                 text NOT NULL DEFAULT 'drafting'
                         CHECK (status IN ('drafting','ready_for_review','approved','sending','needs_code','sent','failed')),
  conversation           jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimate               jsonb,
  computed               jsonb,
  clover_estimate_number text,
  error                  text,
  screenshot_urls        text[] NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estimates_status_idx ON estimates (status, updated_at);

CREATE TABLE IF NOT EXISTS verification_codes (
  id          bigserial PRIMARY KEY,
  estimate_id uuid REFERENCES estimates(id) ON DELETE CASCADE,
  code        text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id          bigserial PRIMARY KEY,
  estimate_id uuid REFERENCES estimates(id) ON DELETE CASCADE,
  type        text NOT NULL,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_estimate_idx ON events (estimate_id, created_at);

-- Milestone 3: photos are tracked by the server, not by the AI.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';

-- Photos and worker screenshots live in Postgres (no external file storage needed).
CREATE TABLE IF NOT EXISTS files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id  uuid REFERENCES estimates(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('photo','screenshot','text')),
  name         text NOT NULL,
  content_type text NOT NULL,
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_estimate_idx ON files (estimate_id, kind, created_at);

-- Human-assisted Clover sign-in (live view). A person signs in through the app; the worker keeps the session.
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_status_check;
ALTER TABLE estimates ADD CONSTRAINT estimates_status_check
  CHECK (status IN ('drafting','ready_for_review','approved','sending','needs_code','needs_login','sent','failed'));

CREATE TABLE IF NOT EXISTS clover_login (
  id          bigserial PRIMARY KEY,
  status      text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','active','done','failed','cancelled')),
  reason      text,                 -- why it was needed: 'estimate', 'manual'
  frame       bytea,                -- latest JPEG of the worker's browser (cleared when done)
  frame_at    timestamptz,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- True while a text box is focused in the worker's browser, so the phone can offer its keyboard.
ALTER TABLE clover_login ADD COLUMN IF NOT EXISTS typing boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS clover_login_status_idx ON clover_login (status, created_at);

-- Taps and typing from the phone; deleted as soon as the worker applies them.
CREATE TABLE IF NOT EXISTS clover_login_input (
  id         bigserial PRIMARY KEY,
  login_id   bigint NOT NULL REFERENCES clover_login(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('click','type','key')),
  x          real,
  y          real,
  text       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Look-only scouting tasks for the worker (map Clover screens). Never sends or saves anything.
CREATE TABLE IF NOT EXISTS worker_tasks (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  result      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
