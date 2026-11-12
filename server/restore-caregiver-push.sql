-- Caregiver alerts were paused on 2026-11-03 by a CHECK constraint that kept every
-- destination empty. They are delivered again with generic lock-screen text.
ALTER TABLE IF EXISTS metacare_overdue_settings DROP CONSTRAINT IF EXISTS caregiver_push_retired;
