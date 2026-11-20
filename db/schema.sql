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
