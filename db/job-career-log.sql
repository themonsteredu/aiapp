-- Additive JOB identity mapping. Existing Career Log records remain append-only.
-- Apply with the Supabase migration API as job_career_log_identity_links.
CREATE TABLE IF NOT EXISTS career_log.job_identities (
  student_id uuid PRIMARY KEY REFERENCES career_log.students(id) ON DELETE RESTRICT,
  account_user_id integer UNIQUE,
  guest_key_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((account_user_id IS NOT NULL) <> (guest_key_hash IS NOT NULL)),
  CHECK (guest_key_hash IS NULL OR guest_key_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE career_log.job_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON career_log.job_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON career_log.job_identities TO service_role;
COMMENT ON TABLE career_log.job_identities IS
  'Server-only JOB account or opaque guest credential -> random Career Log student UUID. No name/school based identity matching.';
