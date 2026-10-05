-- Manual stage-3 schema for a disposable, marked local database only.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plaza_environment WHERE test_id = current_setting('plaza.test_id', true)::uuid
      AND database_name = current_database()
      AND ((purpose = 'stage1-local-test' AND current_database() ~ '^plaza_test_[a-z0-9_]+$')
        OR (purpose = 'online-test' AND project_ref = current_setting('plaza.online_ref', true)
          AND to_regnamespace('moakit_accounts') IS NULL AND to_regnamespace('moalab') IS NULL))
  ) THEN RAISE EXCEPTION 'Separate marked local test database required'; END IF;
END $$;
ALTER TABLE plaza_participants ADD COLUMN attendance text NOT NULL DEFAULT 'present' CHECK (attendance IN ('present','absent'));
ALTER TABLE plaza_participants ADD COLUMN connection_version integer NOT NULL DEFAULT 0;
ALTER TABLE plaza_participants ADD COLUMN attendance_version integer NOT NULL DEFAULT 0;
ALTER TABLE plaza_photos ADD COLUMN invalidated_at timestamptz;
CREATE TABLE plaza_operations (
  room_id uuid NOT NULL REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  -- Audit IDs remain after the platform's ordinary expired-guest cleanup.
  attempt_id uuid NOT NULL, actor_user_id integer NOT NULL,
  kind text NOT NULL, digest text NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id,attempt_id)
);
CREATE TABLE plaza_write_receipts (
  participant_id uuid NOT NULL REFERENCES plaza_participants(id) ON DELETE RESTRICT,
  attempt_id uuid NOT NULL, kind text NOT NULL, digest text NOT NULL, result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(participant_id,attempt_id)
);
CREATE TABLE plaza_reissues (
  id uuid PRIMARY KEY, room_id uuid NOT NULL,
  participant_id uuid NOT NULL, code_hash text NOT NULL UNIQUE CHECK (length(code_hash)=64),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  claimed_at timestamptz, claimed_user_id integer,
  claim_attempt_id uuid, claim_session_hash text, grant_id uuid REFERENCES plaza_device_grants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(participant_id,room_id) REFERENCES plaza_participants(id,room_id) ON DELETE RESTRICT,
  CHECK ((claimed_at IS NULL) = (grant_id IS NULL))
);
CREATE UNIQUE INDEX plaza_pending_reissue ON plaza_reissues(participant_id) WHERE revoked_at IS NULL AND claimed_at IS NULL;
CREATE TABLE plaza_claim_limits (
  room_id uuid NOT NULL REFERENCES plaza_rooms(id) ON DELETE RESTRICT,
  subject text NOT NULL, window_start timestamptz NOT NULL DEFAULT now(), failures integer NOT NULL DEFAULT 0,
  PRIMARY KEY(room_id,subject)
);
-- A substituted incoming visit has no visitor; a substituted outgoing visit has no host.
-- Retired rows are retained for audit. A message-bearing row is never reassigned.
ALTER TABLE plaza_visits ALTER COLUMN visitor_id DROP NOT NULL;
ALTER TABLE plaza_visits DROP CONSTRAINT plaza_visits_visitor_id_key;
ALTER TABLE plaza_visits DROP CONSTRAINT plaza_visits_host_id_key;
ALTER TABLE plaza_visits DROP CONSTRAINT plaza_visits_check1;
ALTER TABLE plaza_visits ADD CHECK (visitor_id IS NOT NULL OR host_id IS NOT NULL);
ALTER TABLE plaza_visits ADD CHECK (substitute = (visitor_id IS NULL OR host_id IS NULL));
ALTER TABLE plaza_visits ADD COLUMN retired_at timestamptz;
ALTER TABLE plaza_visits ADD COLUMN reason text;
ALTER TABLE plaza_visits ADD COLUMN fallback_reply jsonb;
CREATE UNIQUE INDEX plaza_current_visitor ON plaza_visits(visitor_id) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX plaza_current_host ON plaza_visits(host_id) WHERE retired_at IS NULL;
DO $$ DECLARE tbl text; role_name text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['plaza_operations','plaza_write_receipts','plaza_reissues','plaza_claim_limits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tbl);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',tbl);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I',tbl,role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
