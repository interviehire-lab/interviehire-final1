DO $$ BEGIN
  CREATE TYPE v2_interview_evaluator AS ENUM ('holistic', 'structured');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE v2_interview_evaluation_status AS ENUM ('running', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS evaluation jsonb;
CREATE TABLE IF NOT EXISTS v2_interview_evaluations (
  session_id text NOT NULL REFERENCES v2_interview_sessions(id),
  evaluator v2_interview_evaluator NOT NULL, status v2_interview_evaluation_status NOT NULL,
  attempt integer NOT NULL DEFAULT 0, result jsonb, error_code text,
  started_at timestamptz NOT NULL, completed_at timestamptz,
  PRIMARY KEY (session_id, evaluator)
);
