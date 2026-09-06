DO $$ BEGIN
  CREATE TYPE v2_interview_session_status AS ENUM ('scheduled', 'in_progress', 'completed', 'evaluating', 'evaluated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE v2_interview_session_stage AS ENUM ('recruiter_screening', 'functional_interview');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS v2_interview_sessions (
  id text PRIMARY KEY, tenant_id text NOT NULL, application_id text NOT NULL,
  interview_stage v2_interview_session_stage NOT NULL,
  status v2_interview_session_status NOT NULL DEFAULT 'scheduled',
  scheduled_at timestamptz NOT NULL, time_zone text NOT NULL, hard_limit_seconds integer NOT NULL,
  correlation_id text NOT NULL, idempotency_key text NOT NULL, created_at timestamptz NOT NULL,
  CONSTRAINT v2_interview_session_distinct_ids CHECK (id <> application_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_interview_session_idempotency_idx ON v2_interview_sessions (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS v2_interview_session_application_idx ON v2_interview_sessions (tenant_id, application_id);
