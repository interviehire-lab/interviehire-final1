CREATE TABLE IF NOT EXISTS v2_hiring_outbox (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_id text NOT NULL,
  tenant_id text NOT NULL,
  correlation_id text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  published_at timestamptz,
  publish_attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS v2_hiring_outbox_pending_idx
  ON v2_hiring_outbox (published_at, occurred_at);
