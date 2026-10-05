-- Manual local-test schema; never part of lib/db.js automatic setup.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plaza_environment WHERE test_id = current_setting('plaza.test_id', true)::uuid
      AND database_name = current_database()
      AND ((purpose = 'stage1-local-test' AND current_database() ~ '^plaza_test_[a-z0-9_]+$')
        OR (purpose = 'online-test' AND project_ref = current_setting('plaza.online_ref', true)
          AND to_regnamespace('moakit_accounts') IS NULL AND to_regnamespace('moalab') IS NULL))
  ) THEN RAISE EXCEPTION 'Separate marked local test database required'; END IF;
END $$;
ALTER TABLE plaza_participants ALTER COLUMN student_uuid DROP NOT NULL;
ALTER TABLE plaza_participants ADD COLUMN record_choice text NOT NULL DEFAULT 'record' CHECK(record_choice IN ('record','no-record'));
ALTER TABLE plaza_participants ADD COLUMN photo_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE plaza_participants ADD COLUMN privacy_version integer NOT NULL DEFAULT 0;
ALTER TABLE plaza_participants ADD COLUMN notice_version text NOT NULL DEFAULT 'stage4-test-1';
ALTER TABLE plaza_participants ADD COLUMN activity_completed_at timestamptz;
ALTER TABLE plaza_participants ADD CHECK ((record_choice='record')=(student_uuid IS NOT NULL));
ALTER TABLE plaza_rooms ADD COLUMN photos_purged_at timestamptz;
ALTER TABLE plaza_rooms ADD COLUMN activities_purged_at timestamptz;
ALTER TABLE plaza_rooms ADD COLUMN audit_purged_at timestamptz;
CREATE TABLE plaza_retention_policies (
  room_id uuid PRIMARY KEY REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK(version=1),
  status text NOT NULL DEFAULT 'test-only' CHECK(status='test-only'),
  photo_hours integer NOT NULL CHECK(photo_hours BETWEEN 0 AND 87600),
  activity_hours integer NOT NULL CHECK(activity_hours BETWEEN 0 AND 87600),
  audit_hours integer NOT NULL CHECK(audit_hours BETWEEN 0 AND 87600),
  created_by integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(audit_hours>=photo_hours AND audit_hours>=activity_hours)
);
CREATE TABLE plaza_purge_jobs (
  id uuid PRIMARY KEY, room_id uuid REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  participant_id uuid, scopes jsonb NOT NULL,
  attempt_id uuid NOT NULL UNIQUE, actor_user_id integer NOT NULL,
  request_digest text NOT NULL, manifest_digest text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','verified')),
  activities_done_at timestamptz, audit_done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz,
  whole_system_complete boolean NOT NULL DEFAULT false CHECK(NOT whole_system_complete)
);
CREATE TABLE plaza_purge_items (
  job_id uuid NOT NULL REFERENCES plaza_purge_jobs(id) ON DELETE RESTRICT,
  object_key text NOT NULL CHECK(object_key ~ '^[0-9a-f-]{36}\.jpg$'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','retry','verified')),
  attempts integer NOT NULL DEFAULT 0, failure_code text, verified_at timestamptz,
  PRIMARY KEY(job_id,object_key)
);
CREATE INDEX plaza_purge_room ON plaza_purge_jobs(room_id,created_at);
DO $$ DECLARE tbl text; role_name text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['plaza_retention_policies','plaza_purge_jobs','plaza_purge_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tbl);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',tbl,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
