-- Older deployments may still receive queue callbacks or registration requests.
-- Clear their delivery destinations and keep them disabled across deploys.
DO $$
DECLARE
  registrations regclass := to_regclass('metacare_overdue_settings');
BEGIN
  IF registrations IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid = registrations AND conname = 'caregiver_push_retired') THEN
    ALTER TABLE metacare_overdue_settings ADD CONSTRAINT caregiver_push_retired
      CHECK (push_token IS NULL AND next_job IS NULL) NOT VALID;
  END IF;
  UPDATE metacare_overdue_settings SET push_token = NULL, next_job = NULL
    WHERE push_token IS NOT NULL OR next_job IS NOT NULL;
  ALTER TABLE metacare_overdue_settings VALIDATE CONSTRAINT caregiver_push_retired;
END $$;
