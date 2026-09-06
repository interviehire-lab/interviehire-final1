DO $$ BEGIN CREATE TYPE v2_notification_channel AS ENUM ('email', 'whatsapp', 'robocall'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE v2_notification_status AS ENUM ('running', 'sent', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS v2_notification_deliveries (
  id text PRIMARY KEY, tenant_id text NOT NULL, channel v2_notification_channel NOT NULL,
  status v2_notification_status NOT NULL, attempt integer NOT NULL DEFAULT 0,
  provider_message_id text, error_code text, started_at timestamptz NOT NULL, completed_at timestamptz
);
