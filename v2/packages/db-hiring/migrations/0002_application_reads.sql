DO $$ BEGIN
  CREATE TYPE v2_resume_analysis_status AS ENUM ('not_requested', 'queued', 'running', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE v2_applications ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE v2_applications ADD COLUMN IF NOT EXISTS candidate_name text;
ALTER TABLE v2_applications ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE v2_applications ADD COLUMN IF NOT EXISTS resume_analysis_status v2_resume_analysis_status NOT NULL DEFAULT 'not_requested';

CREATE INDEX IF NOT EXISTS v2_applications_tenant_job_idx ON v2_applications (tenant_id, job_id);
