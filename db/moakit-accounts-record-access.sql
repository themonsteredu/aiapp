-- 학교 학생의 진로기록을 열람·수정할 수 있는 담당자(제품 사용자) 목록.
-- 관리자는 자기가 관리하는 학교(managers 또는 school_access)를 항상 열람·수정한다.
-- 그 밖의 사용자(예: 외부 진로기관 담당자로 등록한 강사 계정)는 이 표의 행이 있어야 한다.
-- level: 'view' = 열람만 · 'edit' = 열람 + 정정(새 버전 추가) + 기록 추가
-- 기록 원본은 append-only 라서 수정은 supersedes_id 로 이어지는 새 레코드로 남긴다.
-- 적용: Supabase 프로젝트 vypnobpmyadtcvxhtagn, migration moakit_accounts_record_access (2026-09-13)
CREATE TABLE IF NOT EXISTS moakit_accounts.record_access (
  school_id uuid NOT NULL REFERENCES moakit_accounts.schools(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  issuer text NOT NULL CHECK (issuer ~ '^moakit-[a-z]{2,20}$'),
  user_id text NOT NULL CHECK (btrim(user_id) <> ''),
  level text NOT NULL CHECK (level IN ('view', 'edit')),
  granted_by text NOT NULL CHECK (btrim(granted_by) <> ''),   -- '<issuer>:<관리자 ID>'
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, issuer, user_id)
);
CREATE INDEX IF NOT EXISTS record_access_user_idx ON moakit_accounts.record_access (issuer, user_id);
ALTER TABLE moakit_accounts.record_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE moakit_accounts.record_access FORCE ROW LEVEL SECURITY;
REVOKE ALL ON moakit_accounts.record_access FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE moakit_accounts.record_access IS
  'Per-school record view/edit grants for product users (e.g. an external career institution contact). Server-only.';
