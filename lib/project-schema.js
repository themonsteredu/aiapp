'use strict';

const { GWANGJU_RESOURCES } = require('./gwangju-pick');

const PROJECT_SCHEMA = `
CREATE TABLE IF NOT EXISTS resource_datasets (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resource_items (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id INT NOT NULL REFERENCES resource_datasets(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL,
  official_name TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_status TEXT NOT NULL DEFAULT '검증 필요',
  checked_at DATE,
  source_url TEXT NOT NULL DEFAULT '',
  operator_memo TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dataset_id, resource_key)
);

CREATE TABLE IF NOT EXISTS projects (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  school_label TEXT NOT NULL DEFAULT '',
  class_label TEXT NOT NULL DEFAULT '',
  starts_on DATE,
  ends_on DATE,
  mission TEXT NOT NULL DEFAULT '',
  template_key TEXT NOT NULL DEFAULT 'gwangju-pick',
  dataset_id INT REFERENCES resource_datasets(id) ON DELETE SET NULL,
  current_session INT NOT NULL DEFAULT 1 CHECK (current_session BETWEEN 1 AND 6),
  session_visibility JSONB NOT NULL DEFAULT '[true,false,false,false,false,false]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  retention_until DATE,
  delete_scheduled_at TIMESTAMPTZ,
  class_session_id INT REFERENCES class_sessions(id) ON DELETE SET NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_teams (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  team_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '미시작',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, team_code)
);

CREATE TABLE IF NOT EXISTS project_members (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  anonymous_no TEXT NOT NULL,
  team_role TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, anonymous_no)
);

CREATE TABLE IF NOT EXISTS session_progress (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  session_no INT NOT NULL CHECK (session_no BETWEEN 1 AND 6),
  status TEXT NOT NULL DEFAULT '미시작',
  draft_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed_data JSONB,
  last_saved_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  UNIQUE (team_id, session_no)
);

CREATE TABLE IF NOT EXISTS app_configs (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL UNIQUE REFERENCES project_teams(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_versions (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  version_no INT NOT NULL,
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, version_no)
);

CREATE TABLE IF NOT EXISTS user_test_feedback (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  tester_code TEXT NOT NULL DEFAULT '',
  liked TEXT NOT NULL DEFAULT '',
  confusing TEXT NOT NULL DEFAULT '',
  suggestion TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS career_reflections (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  anonymous_no TEXT NOT NULL,
  reflection JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, anonymous_no)
);

CREATE TABLE IF NOT EXISTS assessment_results (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL REFERENCES project_teams(id) ON DELETE CASCADE,
  anonymous_no TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('pre','post','peer')),
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  score JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, anonymous_no, phase)
);

CREATE TABLE IF NOT EXISTS published_apps (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  team_id INT NOT NULL UNIQUE REFERENCES project_teams(id) ON DELETE CASCADE,
  version_id INT REFERENCES app_versions(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS project_id INT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS project_team_id INT REFERENCES project_teams(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS anonymous_no TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(created_by, created_at);
CREATE INDEX IF NOT EXISTS idx_project_teams_project ON project_teams(project_id);
CREATE INDEX IF NOT EXISTS idx_session_progress_team ON session_progress(team_id, session_no);
CREATE INDEX IF NOT EXISTS idx_resource_items_dataset ON resource_items(dataset_id);
`;

async function seedGwangjuDataset(q) {
  const rows = await q(
    `INSERT INTO resource_datasets (slug, name, description)
     VALUES ('gwangju-verified-v1', '광주 지역자원 검증 데이터셋', '광주픽 수업용 공식 출처 중심 초기 데이터')
     ON CONFLICT (slug) DO UPDATE SET updated_at = now()
     RETURNING id`
  );
  let datasetId = rows[0]?.id;
  if (!datasetId) {
    datasetId = (await q("SELECT id FROM resource_datasets WHERE slug = 'gwangju-verified-v1'"))[0].id;
  }
  for (const resource of GWANGJU_RESOURCES) {
    await q(
      `INSERT INTO resource_items
       (dataset_id, resource_key, official_name, data, verification_status, checked_at, source_url, operator_memo)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
       ON CONFLICT (dataset_id, resource_key) DO UPDATE SET
         official_name = EXCLUDED.official_name,
         data = EXCLUDED.data,
         verification_status = EXCLUDED.verification_status,
         checked_at = EXCLUDED.checked_at,
         source_url = EXCLUDED.source_url,
         operator_memo = EXCLUDED.operator_memo,
         updated_at = now()`,
      [
        datasetId,
        resource.id,
        resource.name,
        JSON.stringify(resource),
        resource.verificationStatus,
        resource.checkedAt || null,
        resource.sourceUrl || '',
        resource.operatorMemo || '',
      ]
    );
  }
  return datasetId;
}

async function initProjectSchema(pool, q) {
  await pool.query(PROJECT_SCHEMA);
  await seedGwangjuDataset(q);
}

module.exports = { PROJECT_SCHEMA, initProjectSchema, seedGwangjuDataset };
