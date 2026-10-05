-- REVIEWABLE STAGE-1 PROPOSAL. Not part of lib/db.js or automatic migrations.
-- The dedicated local-test setup script sets these values before applying this file.
-- Do not run on a shared/production database.
-- Online test (docs/plaza-online-test.md): Supabase names the database 'postgres', so the
-- disposable project is named by plaza.online_ref instead, and the central MoaKit/MoaLab schemas
-- of the production project must be absent.
DO $$ BEGIN
  -- COALESCE: an unset setting is NULL, and IF NULL would not raise.
  IF NOT COALESCE(current_setting('plaza.test_id', true) IS NOT NULL AND (
    current_database() ~ '^plaza_test_[a-z0-9_]+$'
    OR (current_database() = 'postgres' AND current_setting('plaza.online_ref', true) IS NOT DISTINCT FROM 'yxnenjtmuvdlfxnwxecp'
        AND to_regnamespace('moakit_accounts') IS NULL AND to_regnamespace('moalab') IS NULL)
  ), false) THEN
    RAISE EXCEPTION 'A separate plaza_test_ database and test marker are required';
  END IF;
END $$;

CREATE TABLE plaza_environment (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  test_id uuid NOT NULL,
  database_name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('stage1-local-test','online-test')),
  project_ref text,
  CHECK ((purpose = 'online-test') = (project_ref IS NOT NULL))
);
INSERT INTO plaza_environment VALUES (true, current_setting('plaza.test_id')::uuid, current_database(),
  CASE WHEN current_database() = 'postgres' THEN 'online-test' ELSE 'stage1-local-test' END,
  CASE WHEN current_database() = 'postgres' THEN current_setting('plaza.online_ref') END);
CREATE TABLE plaza_program_versions (
  id uuid PRIMARY KEY,
  program_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  deck_id integer NOT NULL REFERENCES decks(id) ON DELETE RESTRICT,
  card jsonb NOT NULL,
  review_status text NOT NULL CHECK (review_status = 'test-only'),
  UNIQUE (program_key, version), UNIQUE (id, deck_id)
);
CREATE TABLE plaza_rooms (
  id uuid PRIMARY KEY,
  class_session_id integer NOT NULL REFERENCES class_sessions(id) ON DELETE RESTRICT,
  deck_id integer NOT NULL,
  program_version_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'planning' CHECK (state IN ('planning','paused','closed')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  seat_count integer NOT NULL CHECK (seat_count BETWEEN 1 AND 100),
  is_test boolean NOT NULL DEFAULT true CHECK (is_test),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_session_id, deck_id),
  FOREIGN KEY (program_version_id, deck_id) REFERENCES plaza_program_versions(id, deck_id) ON DELETE RESTRICT,
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);
CREATE TABLE plaza_participants (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  student_uuid uuid NOT NULL REFERENCES career_log.students(id) ON DELETE RESTRICT,
  seat_order integer NOT NULL CHECK (seat_order BETWEEN 1 AND 100),
  store_public_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','left','closed')),
  target_version integer NOT NULL DEFAULT 1,
  current_photo_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, room_id)
);
CREATE UNIQUE INDEX plaza_active_seat ON plaza_participants(room_id, seat_order) WHERE status = 'active';
CREATE TABLE plaza_device_grants (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  login_user_id integer NOT NULL,
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  session_hash text NOT NULL CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  version integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (participant_id, room_id) REFERENCES plaza_participants(id, room_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX plaza_one_active_grant ON plaza_device_grants(participant_id) WHERE revoked_at IS NULL;
CREATE INDEX plaza_login_grant ON plaza_device_grants(login_user_id) WHERE revoked_at IS NULL;
CREATE TABLE plaza_drafts (
  participant_id uuid PRIMARY KEY REFERENCES plaza_participants(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 0,
  content jsonb NOT NULL DEFAULT '{}',
  last_attempt_id uuid,
  last_digest text,
  saved_at timestamptz
);
CREATE TABLE plaza_photos (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  target_version integer NOT NULL,
  capture_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','stored','failed')),
  created_by integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  saved_at timestamptz,
  UNIQUE (id, participant_id),
  FOREIGN KEY (participant_id, room_id) REFERENCES plaza_participants(id, room_id) ON DELETE RESTRICT
);
ALTER TABLE plaza_participants ADD CONSTRAINT plaza_current_photo_owner
  FOREIGN KEY (current_photo_id, id) REFERENCES plaza_photos(id, participant_id) ON DELETE RESTRICT;
CREATE TABLE plaza_photo_objects (
  id uuid PRIMARY KEY,
  photo_id uuid NOT NULL UNIQUE REFERENCES plaza_photos(id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^[0-9a-f-]{36}\.jpg$'),
  mime text NOT NULL DEFAULT 'image/jpeg' CHECK (mime = 'image/jpeg'),
  digest text, bytes integer, width integer, height integer,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','stored','cleanup-required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  delete_confirmed_at timestamptz
);
CREATE TABLE plaza_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  participant_id uuid,
  actor_user_id integer NOT NULL,
  kind text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (participant_id, room_id) REFERENCES plaza_participants(id, room_id) ON DELETE RESTRICT
);
CREATE INDEX plaza_participant_room ON plaza_participants(room_id);
CREATE INDEX plaza_photo_room ON plaza_photos(room_id, participant_id);
CREATE INDEX plaza_event_room ON plaza_events(room_id, id);
DO $$ DECLARE tbl text; role_name text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['plaza_environment','plaza_program_versions','plaza_rooms','plaza_participants',
    'plaza_device_grants','plaza_drafts','plaza_photos','plaza_photo_objects','plaza_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tbl);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', tbl, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
