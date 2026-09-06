ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS time_zone text;
ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS delivery_methods jsonb;
ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE v2_application_interview_refs ADD COLUMN IF NOT EXISTS actor_id text;
CREATE UNIQUE INDEX IF NOT EXISTS v2_schedule_idempotency_idx
  ON v2_application_interview_refs (tenant_id, idempotency_key);
