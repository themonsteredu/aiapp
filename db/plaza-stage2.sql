-- Manual, additive stage-2 test schema. Never loaded by lib/db.js.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plaza_environment WHERE test_id = current_setting('plaza.test_id', true)::uuid
      AND database_name = current_database()
      AND ((purpose = 'stage1-local-test' AND current_database() ~ '^plaza_test_[a-z0-9_]+$')
        OR (purpose = 'online-test' AND project_ref = current_setting('plaza.online_ref', true)
          AND to_regnamespace('moakit_accounts') IS NULL AND to_regnamespace('moalab') IS NULL))
  ) THEN RAISE EXCEPTION 'Separate marked local test database required'; END IF;
END $$;
ALTER TABLE plaza_rooms DROP CONSTRAINT plaza_rooms_state_check;
ALTER TABLE plaza_rooms ADD CHECK (state IN ('planning','paused','returning','exchange','reflection','closed'));
CREATE TABLE plaza_activities (
  participant_id uuid PRIMARY KEY REFERENCES plaza_participants(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0,
  actual jsonb, reflection jsonb,
  last_attempt_id uuid, last_digest text, saved_at timestamptz
);
CREATE TABLE plaza_ai_runs (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ideas','reply')),
  attempt_id uuid NOT NULL,
  input_digest text NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('running','ready')),
  source text CHECK (source IN ('ai','example')),
  call_attempted boolean NOT NULL,
  failure_code text,
  output jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id,kind),
  FOREIGN KEY (participant_id,room_id) REFERENCES plaza_participants(id,room_id) ON DELETE RESTRICT
);
CREATE TABLE plaza_visits (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  visitor_id uuid NOT NULL UNIQUE,
  host_id uuid UNIQUE,
  substitute boolean NOT NULL DEFAULT false,
  request jsonb, reply jsonb, reaction jsonb,
  FOREIGN KEY (visitor_id,room_id) REFERENCES plaza_participants(id,room_id) ON DELETE RESTRICT,
  FOREIGN KEY (host_id,room_id) REFERENCES plaza_participants(id,room_id) ON DELETE RESTRICT,
  CHECK (host_id IS DISTINCT FROM visitor_id),
  CHECK (substitute = (host_id IS NULL))
);
CREATE TABLE plaza_record_receipts (
  participant_id uuid PRIMARY KEY REFERENCES plaza_participants(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL UNIQUE,
  snapshot jsonb NOT NULL,
  digest text NOT NULL,
  record_id uuid UNIQUE REFERENCES career_log.records(id) ON DELETE RESTRICT,
  saved_at timestamptz,
  CHECK ((record_id IS NULL) = (saved_at IS NULL))
);
CREATE TABLE plaza_teacher_materials (
  program_version_id uuid PRIMARY KEY REFERENCES plaza_program_versions(id) ON DELETE RESTRICT,
  content jsonb NOT NULL,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plaza_ai_room ON plaza_ai_runs(room_id);
CREATE INDEX plaza_visit_room ON plaza_visits(room_id);
DO $$ DECLARE tbl text; role_name text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['plaza_activities','plaza_ai_runs','plaza_visits','plaza_record_receipts','plaza_teacher_materials'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tbl);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',tbl,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
