CREATE TABLE IF NOT EXISTS v2_resume_analysis_runs (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES v2_applications(id),
  tenant_id text NOT NULL,
  status v2_resume_analysis_status NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  resume_revision integer NOT NULL,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_resume_runs_idempotency_idx
  ON v2_resume_analysis_runs (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS v2_resume_runs_application_idx
  ON v2_resume_analysis_runs (application_id, created_at);
