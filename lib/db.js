'use strict';
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

CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);
CREATE INDEX IF NOT EXISTS idx_logs_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_action ON audit_logs(action);
`;

async function init() {
  await pool.query(SCHEMA);

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
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
}

// 서버리스: 인스턴스(콜드 스타트)당 1회만 초기화
let readyPromise = null;
function ready() {
  readyPromise ||= init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

const STRING_SETTING_KEYS = new Set(['ip_allowlist']);

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
