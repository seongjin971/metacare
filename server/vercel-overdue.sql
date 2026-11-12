CREATE TABLE IF NOT EXISTS metacare_overdue_settings (
  patient_id text PRIMARY KEY REFERENCES metacare_patients(id) ON DELETE CASCADE,
  pair_hash text NOT NULL,
  subscription_key text NOT NULL,
  push_token text UNIQUE,
  threshold integer NOT NULL CHECK (threshold IN (15,30,60,120)),
  time_zone text,
  next_job jsonb
);

CREATE TABLE IF NOT EXISTS metacare_overdue_deliveries (
  patient_id text NOT NULL REFERENCES metacare_overdue_settings(patient_id) ON DELETE CASCADE,
  dose_date date NOT NULL,
  dose_time text NOT NULL,
  generation text NOT NULL,
  claimed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (patient_id, dose_date, dose_time)
);

ALTER TABLE metacare_overdue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE metacare_overdue_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON metacare_overdue_settings, metacare_overdue_deliveries FROM PUBLIC;
