DO $$ BEGIN CREATE TYPE v2_automation_status AS ENUM ('running', 'complete', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS v2_automation_runs (
  id text PRIMARY KEY, status v2_automation_status NOT NULL, attempt integer NOT NULL DEFAULT 0,
  result jsonb, error_code text, started_at timestamptz NOT NULL, completed_at timestamptz
);
