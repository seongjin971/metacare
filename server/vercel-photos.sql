CREATE TABLE IF NOT EXISTS metacare_photos (
  patient_id text NOT NULL REFERENCES metacare_patients(id) ON DELETE CASCADE,
  photo_id text NOT NULL,
  version text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  pixels bytea NOT NULL CHECK (octet_length(pixels) BETWEEN 1 AND 5242880),
  PRIMARY KEY (patient_id, photo_id)
);

ALTER TABLE metacare_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON metacare_photos FROM PUBLIC;

-- Keep incomplete uploads separate so a failed replacement never hides a complete photo.
CREATE TABLE IF NOT EXISTS metacare_photo_uploads (
  patient_id text NOT NULL REFERENCES metacare_patients(id) ON DELETE CASCADE,
  photo_id text NOT NULL,
  upload_id text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  expected_bytes integer NOT NULL CHECK (expected_bytes BETWEEN 3145729 AND 5242880),
  first_part bytea NOT NULL CHECK (octet_length(first_part) = 3145728),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (patient_id, photo_id)
);

ALTER TABLE metacare_photo_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON metacare_photo_uploads FROM PUBLIC;
