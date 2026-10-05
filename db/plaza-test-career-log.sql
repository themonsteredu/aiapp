-- Minimal fake Career Log schema for a disposable plaza test database only.
-- No central school accounts are created or copied. Never run where career_log already exists.
-- Records are append-only like the real Career Log: corrections are new rows (supersedes_id).
CREATE SCHEMA career_log;
CREATE TABLE career_log.students (id uuid PRIMARY KEY);
CREATE TABLE career_log.records (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), student_id uuid REFERENCES career_log.students(id),
  session_ref text,program_ref text,occurred_at timestamptz,process text,artifact text,reflection text,source text,
  verification_status text,verified_by text,verified_at timestamptz,raw_data jsonb,source_event_id text UNIQUE,supersedes_id uuid);
CREATE FUNCTION career_log.records_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'career_log.records is append-only'; END $$;
CREATE TRIGGER records_append_only BEFORE UPDATE OR DELETE ON career_log.records
  FOR EACH ROW EXECUTE FUNCTION career_log.records_append_only();
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
REVOKE ALL ON SCHEMA career_log FROM PUBLIC, anon, authenticated;
ALTER TABLE career_log.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE career_log.records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON career_log.students, career_log.records FROM PUBLIC, anon, authenticated;
