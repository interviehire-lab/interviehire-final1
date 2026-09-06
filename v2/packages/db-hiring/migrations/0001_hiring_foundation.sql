DO $$ BEGIN
  CREATE TYPE v2_application_stage AS ENUM ('resume_analysis', 'recruiter_screening', 'functional_interview');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE v2_application_decision AS ENUM ('active', 'hired', 'rejected', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE v2_interview_stage AS ENUM ('recruiter_screening', 'functional_interview');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS v2_applications (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  stage v2_application_stage NOT NULL DEFAULT 'resume_analysis',
  decision v2_application_decision NOT NULL DEFAULT 'active',
  resume_analysis_complete boolean NOT NULL DEFAULT false,
  screening_complete boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS v2_applications_tenant_stage_idx ON v2_applications (tenant_id, stage);

CREATE TABLE IF NOT EXISTS v2_application_stage_history (
  id text PRIMARY KEY,
  application_id text NOT NULL REFERENCES v2_applications(id),
  tenant_id text NOT NULL,
  from_stage v2_application_stage NOT NULL,
  to_stage v2_application_stage NOT NULL,
  actor_id text NOT NULL,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_application_history_idempotency_idx
  ON v2_application_stage_history (tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS v2_application_history_application_idx
  ON v2_application_stage_history (application_id, occurred_at);

CREATE TABLE IF NOT EXISTS v2_application_interview_refs (
  application_id text NOT NULL REFERENCES v2_applications(id),
  interview_session_id text NOT NULL,
  interview_stage v2_interview_stage NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT v2_application_interview_stage_unique UNIQUE (application_id, interview_stage),
  CONSTRAINT v2_interview_session_ref_unique UNIQUE (interview_session_id)
);
