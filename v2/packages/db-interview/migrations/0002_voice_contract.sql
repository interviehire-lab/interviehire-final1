ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS candidate_name text NOT NULL DEFAULT 'Candidate';
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS role_title text NOT NULL DEFAULT 'Interview';
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS initial_question text NOT NULL DEFAULT 'Tell me about your professional background.';
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS resume_present boolean NOT NULL DEFAULT false;
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS transcript jsonb NOT NULL DEFAULT '[]';
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE v2_interview_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS v2_interview_turns (
  session_id text NOT NULL REFERENCES v2_interview_sessions(id), turn_id text NOT NULL,
  candidate_text text NOT NULL, ai jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, turn_id)
);

CREATE TABLE IF NOT EXISTS v2_interview_outbox (
  event_id text PRIMARY KEY, event_type text NOT NULL, aggregate_id text NOT NULL,
  tenant_id text NOT NULL, correlation_id text NOT NULL, payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL, published_at timestamptz, publish_attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS v2_interview_outbox_pending_idx ON v2_interview_outbox (published_at, occurred_at);
