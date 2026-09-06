ALTER TABLE v2_applications ADD COLUMN IF NOT EXISTS candidate_email text;
ALTER TABLE v2_applications ADD COLUMN IF NOT EXISTS candidate_phone text;
