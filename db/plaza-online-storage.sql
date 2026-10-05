-- DB-backed photo store for the plaza test (lib/plaza-storage.js pgTestStorage).
-- Manual, after db/plaza-stage4.sql. Never loaded by lib/db.js.
-- Used by the online test project (no disk on Vercel) and by local runs with PLAZA_PHOTO_STORE=pg.
-- Unlike the file ledger, plaza_purge_ledger is inside database snapshots: a restored test
-- database is discarded, never reopened to students (docs/plaza-online-test.md).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM plaza_environment WHERE test_id = current_setting('plaza.test_id', true)::uuid
      AND database_name = current_database()
      AND ((purpose = 'stage1-local-test' AND current_database() ~ '^plaza_test_[a-z0-9_]+$')
        OR (purpose = 'online-test' AND project_ref = current_setting('plaza.online_ref', true)
          AND to_regnamespace('moakit_accounts') IS NULL AND to_regnamespace('moalab') IS NULL))
  ) THEN RAISE EXCEPTION 'Separate marked test database required'; END IF;
END $$;
CREATE TABLE plaza_store_marker (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  test_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'pg-test-store')
);
INSERT INTO plaza_store_marker VALUES (true, current_setting('plaza.test_id')::uuid, 'pg-test-store');
-- No foreign key to plaza_photo_objects: orphan objects must stay possible and listable.
CREATE TABLE plaza_photo_blobs (
  object_key text PRIMARY KEY CHECK (object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  data bytea NOT NULL CHECK (octet_length(data) BETWEEN 32 AND 675000),
  digest text NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (digest = encode(sha256(data), 'hex') AND bytes = octet_length(data))
);
ALTER TABLE plaza_photo_blobs ALTER COLUMN data SET STORAGE EXTERNAL;
CREATE FUNCTION plaza_photo_blobs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'plaza photo objects are immutable'; END $$;
CREATE TRIGGER plaza_photo_blobs_no_update BEFORE UPDATE ON plaza_photo_blobs
  FOR EACH ROW EXECUTE FUNCTION plaza_photo_blobs_immutable();
-- Same merge rule as the file ledger: created_at kept, scopes and keys only grow.
CREATE TABLE plaza_purge_ledger (
  kind text NOT NULL CHECK (kind IN ('object','room','photo-choice')),
  id text NOT NULL CHECK (id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jpg)?$'),
  details jsonb NOT NULL DEFAULT '{}',
  scopes text[] NOT NULL DEFAULT '{}',
  keys text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);
CREATE FUNCTION plaza_purge_ledger_grows() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'plaza purge ledger rows are never deleted'; END IF;
  IF NEW.created_at <> OLD.created_at OR NOT (NEW.scopes @> OLD.scopes) OR NOT (NEW.keys @> OLD.keys) THEN
    RAISE EXCEPTION 'plaza purge ledger only grows';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plaza_purge_ledger_only_grows BEFORE UPDATE OR DELETE ON plaza_purge_ledger
  FOR EACH ROW EXECUTE FUNCTION plaza_purge_ledger_grows();
DO $$ DECLARE tbl text; role_name text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['plaza_store_marker','plaza_photo_blobs','plaza_purge_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', tbl);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', tbl, role_name);
      END IF;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION plaza_photo_blobs_immutable(), plaza_purge_ledger_grows() FROM PUBLIC;
