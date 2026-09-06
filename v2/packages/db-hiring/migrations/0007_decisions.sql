CREATE TABLE IF NOT EXISTS v2_application_decision_history (
  id text PRIMARY KEY, application_id text NOT NULL REFERENCES v2_applications(id), tenant_id text NOT NULL,
  stage v2_application_stage NOT NULL, from_decision v2_application_decision NOT NULL,
  to_decision v2_application_decision NOT NULL, actor_id text NOT NULL, correlation_id text NOT NULL,
  idempotency_key text NOT NULL, occurred_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS v2_application_decision_idempotency_idx ON v2_application_decision_history (tenant_id, idempotency_key);
