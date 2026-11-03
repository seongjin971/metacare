-- Run as the private application database owner. No public client receives database credentials.
CREATE TABLE IF NOT EXISTS metacare_patients (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  snapshot jsonb,
  visit_update jsonb,
  invite jsonb,
  caregiver jsonb,
  CHECK (invite IS NULL OR caregiver IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS metacare_patient_invite
  ON metacare_patients ((invite->>'codeHash')) WHERE invite IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS metacare_caregiver_token
  ON metacare_patients ((caregiver->>'tokenHash')) WHERE caregiver IS NOT NULL;

CREATE TABLE IF NOT EXISTS metacare_rate_limits (
  ip_hash text PRIMARY KEY,
  reset_at timestamptz NOT NULL,
  hits integer NOT NULL
);
CREATE INDEX IF NOT EXISTS metacare_rate_expiry ON metacare_rate_limits (reset_at);

ALTER TABLE metacare_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE metacare_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON metacare_patients, metacare_rate_limits FROM PUBLIC;
