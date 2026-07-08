'use strict';
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { hashPassword } = require('./password');

// Supabase(또는 임의 Postgres) 연결 문자열.
// Vercel 서버리스에서는 Supabase의 Transaction Pooler 주소(포트 6543)를 권장.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다. (예: Supabase 대시보드 → Connect → Transaction pooler URI)');
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 1 : 5)),
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}
async function one(sql, params = []) {
  return (await q(sql, params))[0] || null;
}

// 표시용 시간대 (감사 로그·생성일이 이 시간대 문자열로 반환됨)
const TZ = /^[A-Za-z_/+-]{1,60}$/.test(process.env.APP_TIMEZONE || '') ? process.env.APP_TIMEZONE : 'Asia/Seoul';
// SQL 조각: timestamptz → 'YYYY-MM-DD HH:MM:SS' (KST) 텍스트
const TS = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS')`;
// SQL 조각: 해당 시간대 기준 오늘 0시 (timestamptz)
const KST_TODAY = `(date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','instructor','student')),
  class_name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '', -- 과목(폴더) 분류
  published BOOLEAN NOT NULL DEFAULT false,
  created_by INT NOT NULL,
  target_classes TEXT NOT NULL DEFAULT '',
  access_start TEXT NOT NULL DEFAULT '',
  access_end TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slides (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  bg TEXT NOT NULL DEFAULT 'theme-navy',
  align TEXT NOT NULL DEFAULT 'left'
);

CREATE TABLE IF NOT EXISTS schedules (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  deck_id INT REFERENCES decks(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT,
  ua TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 슬라이드 이미지 자산 (PPT 변환 업로드, base64 저장)
CREATE TABLE IF NOT EXISTS assets (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id INT REFERENCES decks(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1회성 수업 세션 (입장 코드)
CREATE TABLE IF NOT EXISTS class_sessions (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  deck_id INT REFERENCES decks(id) ON DELETE SET NULL, -- NULL = 공개 중인 모든 웹앱
  created_by INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 수업에 담긴 자료 목록 (여러 웹앱/PPT/동영상을 한 수업에 묶고, 학생 공개·잠금을 개별 제어)
CREATE TABLE IF NOT EXISTS session_items (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id INT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  student_visible BOOLEAN NOT NULL DEFAULT true,  -- 학생 목록에 노출 (false = 강사 전용)
  unlocked BOOLEAN NOT NULL DEFAULT true,         -- 지금 학생이 열 수 있는가 (false = 잠금)
  UNIQUE (session_id, deck_id)
);

CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);
CREATE INDEX IF NOT EXISTS idx_logs_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_session_items ON session_items(session_id, position);
`;

// 기존 배포 DB 마이그레이션: 게스트(1회성) 학생 계정이 속한 수업 세션
const MIGRATIONS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_session_id INT;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT '';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'slides';       -- 'slides' | 'link'(외부 웹앱)
ALTER TABLE decks ADD COLUMN IF NOT EXISTS external_url TEXT NOT NULL DEFAULT '';
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS live_deck_id INT;                 -- 라이브 발표 중인 덱 (NULL = 라이브 아님)
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS live_slide INT NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';            -- 배경 라이브러리 표시 이름
ALTER TABLE assets ADD COLUMN IF NOT EXISTS created_by INT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_bg BOOLEAN NOT NULL DEFAULT false;     -- 슬라이드 배경용 여부
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS instructor_id INT;                -- 담당 강사 (관리자가 배정)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS storage_path TEXT;                        -- Supabase Storage 경로 (있으면 data 대신 사용)
ALTER TABLE assets ALTER COLUMN data DROP NOT NULL;                                   -- 스토리지 자산은 data가 비어 있음
-- 삭제 승인 워크플로우 (본인이 요청 → 슈퍼관리자 승인)
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_requested_by INT;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ;
-- 계약·보안 동의
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreed_version INT NOT NULL DEFAULT 0;
-- 요금 유형 (무료 / API 유료) — 종량 과금·분류용
ALTER TABLE decks ADD COLUMN IF NOT EXISTS cost_type TEXT NOT NULL DEFAULT 'free';    -- 'free' | 'api_paid'
ALTER TABLE decks ADD COLUMN IF NOT EXISTS api_provider TEXT NOT NULL DEFAULT '';     -- 예: OpenAI, Anthropic
ALTER TABLE decks ADD COLUMN IF NOT EXISTS unit_cost INT NOT NULL DEFAULT 0;          -- 1인·1회당 예상 원가(원)
`;

// 과정(패키지) — 수업의뢰 단위로 자료를 묶고 강사에게 배정하는 상위 개념
const COURSES_TABLE = `
CREATE TABLE IF NOT EXISTS courses (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 과정에 담긴 자료 (필수/선택 플래그가 여기 붙는다 — 같은 자료도 과정마다 다를 수 있음)
CREATE TABLE IF NOT EXISTS course_items (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  required BOOLEAN NOT NULL DEFAULT true,   -- true=필수(강제), false=선택(강사가 담기)
  position INT NOT NULL DEFAULT 0,
  UNIQUE (course_id, deck_id)
);
-- 강사배정: 어떤 강사가 어떤 과정을 맡는가
CREATE TABLE IF NOT EXISTS course_instructors (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, instructor_id)
);
-- 강사가 담은 선택 자료 (required=false 자료 중 강사가 쓰겠다고 선택한 것)
CREATE TABLE IF NOT EXISTS course_opt_ins (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  opted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, instructor_id, deck_id)
);
`;

// 종량 과금 계측: API 유료 자료 열람/호출을 수업·강사 단위로 귀속해 적재
const USAGE_TABLE = `
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id INT NOT NULL,
  user_id INT,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  session_id INT,                         -- 수업(class_sessions).id — 게스트 사용이면 채워짐
  instructor_id INT,                      -- 귀속 강사 (수업 담당자 또는 자료 소유자)
  calls INT NOT NULL DEFAULT 1,           -- 이 이벤트가 나타내는 호출 수 (열람은 1)
  kind TEXT NOT NULL DEFAULT 'open',      -- 'open'(열람) | 'api_call'(실제 API 호출)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 기존 배포 DB 마이그레이션
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS session_id INT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS instructor_id INT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS calls INT NOT NULL DEFAULT 1;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'open';
CREATE INDEX IF NOT EXISTS idx_usage_deck_time ON usage_events(deck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_instructor ON usage_events(instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);
`;

// 정산: 월·프로바이더별 실제 청구액 입력값 (측정된 호출 비율로 배분)
const SETTLEMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS settlements (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period TEXT NOT NULL,                    -- 정산 월 'YYYY-MM'
  provider TEXT NOT NULL DEFAULT '',       -- API 제공자 (빈값 = 미지정 버킷)
  invoice_amount BIGINT NOT NULL DEFAULT 0,-- 실제 청구 금액(원)
  note TEXT NOT NULL DEFAULT '',
  confirmed BOOLEAN NOT NULL DEFAULT false, -- 정산 확정 여부
  created_by INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, provider)
);
`;

// 계약·동의 기록
const AGREEMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS agreements (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL,
  version INT NOT NULL,
  signed_name TEXT NOT NULL,
  ip TEXT,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// 기본 계약·보안 동의 문서
const DEFAULT_AGREEMENT = `AI 온라인 플랫폼 이용 및 비밀유지 동의서

제1조(목적) 본 동의서는 플랫폼(이하 "회사")과 이용자(관리자·강사, 이하 "이용자") 사이의 수업 콘텐츠 이용 및 개인정보·기밀 보호에 관한 사항을 정함을 목적으로 합니다.

제2조(비밀유지) 이용자는 업무상 알게 된 학생 개인정보, 수업 자료, 접속 기록, 플랫폼의 기술·운영 정보를 제3자에게 누설하거나 업무 외 목적으로 사용하지 않습니다.

제3조(콘텐츠 보호) 이용자는 플랫폼에 게시된 PPT·동영상·웹앱 등 저작물을 무단 복제·배포·유출하지 않으며, 캡처·녹화 등으로 반출하지 않습니다.

제4조(개인정보) 이용자는 학생의 이름·소속 등 개인정보를 수업 목적으로만 처리하고, 수업 종료 후 지체 없이 파기 원칙을 따릅니다.

제5조(계정 보안) 이용자는 본인 계정을 타인과 공유하지 않으며, 유출 시 즉시 관리자에게 통지합니다.

제6조(책임) 본 조항 위반으로 발생한 손해에 대해 이용자는 관련 법령 및 계약에 따라 책임을 집니다.

제7조(동의) 이용자는 위 내용을 충분히 읽고 이해하였으며, 전자적 방식의 동의가 서명과 동일한 효력을 가짐에 동의합니다.`;

async function init() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
  await pool.query(AGREEMENTS_TABLE);
  await pool.query(COURSES_TABLE);
  await pool.query(USAGE_TABLE);
  await pool.query(SETTLEMENTS_TABLE);

  // 슈퍼관리자 시드
  const su = await one("SELECT count(*)::int AS c FROM users WHERE role = 'superadmin'");
  if (su.c === 0) {
    const initialPw = process.env.SUPERADMIN_PASSWORD || 'ChangeMe123!';
    await q(
      "INSERT INTO users (username, password_hash, name, role, must_change_password) VALUES ($1, $2, $3, 'superadmin', true)",
      ['superadmin', hashPassword(initialPw), '슈퍼관리자']
    );
    console.log('최초 실행: 슈퍼관리자 계정 생성 — superadmin /', process.env.SUPERADMIN_PASSWORD ? '(SUPERADMIN_PASSWORD 값)' : 'ChangeMe123!');
  }
  // 기본 접근 시간(월~금 09~18시) 시드
  const sc = await one('SELECT count(*)::int AS c FROM schedules');
  if (sc.c === 0) {
    for (const dow of [1, 2, 3, 4, 5]) {
      await q("INSERT INTO schedules (day_of_week, start_time, end_time) VALUES ($1, '09:00', '18:00')", [dow]);
    }
  }
  // 보안 설정 기본값
  const defaults = {
    block_capture: '1', block_copy: '1', block_rightclick: '1', watermark: '1',
    devtools_detect: '1', single_session: '0', ip_restrict: '0', two_factor: '0',
    ip_allowlist: '',
    // 워터마크 표시 설정: 내용 템플릿({이름}/{아이디}/{시각}), 배치, 진하기
    wm_text: '{이름} ({아이디}) {시각}',
    wm_position: 'tile',
    wm_opacity: 'medium',
    // 계약·보안 동의
    agreement_text: DEFAULT_AGREEMENT,
    agreement_version: '1',
    agreement_required: '1', // 강사·관리자 최초 이용 시 동의 요구
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
  // 외부 웹앱 게이트 토큰 서명용 비밀키 (최초 1회 생성, 클라이언트에 노출 금지)
  await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    ['gate_secret', crypto.randomBytes(24).toString('hex')]);
}

// 서버리스: 인스턴스(콜드 스타트)당 1회만 초기화
let readyPromise = null;
function ready() {
  readyPromise ||= init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

const STRING_SETTING_KEYS = new Set(['ip_allowlist', 'gate_secret', 'wm_text', 'wm_position', 'wm_opacity', 'agreement_text', 'agreement_version']);

async function getSettings() {
  const out = {};
  for (const row of await q('SELECT key, value FROM settings')) {
    out[row.key] = STRING_SETTING_KEYS.has(row.key) ? row.value : row.value === '1';
  }
  return out;
}

async function setSetting(key, value) {
  const stored = STRING_SETTING_KEYS.has(key) ? String(value ?? '') : (value ? '1' : '0');
  await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, stored]);
}

// req가 주어지면 접속 IP와 브라우저 정보를 함께 기록한다.
async function log(user, action, detail = '', req = null) {
  let ip = null;
  let ua = null;
  if (req) {
    ip = clientIp(req);
    ua = String(req.headers['user-agent'] || '').slice(0, 200);
  }
  await q(
    'INSERT INTO audit_logs (user_id, username, action, detail, ip, ua) VALUES ($1, $2, $3, $4, $5, $6)',
    [user ? user.id : null, user ? user.username : null, action, String(detail).slice(0, 500), ip, ua]
  );
}

function clientIp(req) {
  // Vercel 등 신뢰 가능한 프록시 뒤에서는 X-Forwarded-For의 첫 항목을 사용
  if (process.env.TRUST_PROXY === '1' || process.env.VERCEL) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

module.exports = { q, one, ready, log, getSettings, setSetting, clientIp, TS, KST_TODAY };
