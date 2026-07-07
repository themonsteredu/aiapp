'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./password');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','instructor','student')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS slides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  bg TEXT NOT NULL DEFAULT 'theme-navy',
  align TEXT NOT NULL DEFAULT 'left'
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  deck_id INTEGER REFERENCES decks(id) ON DELETE CASCADE, -- NULL = 전체 웹앱 허용
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);
CREATE INDEX IF NOT EXISTS idx_logs_time ON audit_logs(created_at);
`);

// 기존 DB 마이그레이션: 컬럼이 이미 있으면 무시
function addColumn(table, def) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`); } catch {}
}
addColumn('users', "class_name TEXT NOT NULL DEFAULT ''");   // 학생 소속 반
addColumn('users', 'totp_secret TEXT');                       // 2단계 인증 비밀키
addColumn('users', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
addColumn('decks', "target_classes TEXT NOT NULL DEFAULT ''"); // 대상 반 (쉼표 구분, 비면 전체)
addColumn('decks', "access_start TEXT NOT NULL DEFAULT ''");   // 권한 기간 시작 (YYYY-MM-DD)
addColumn('decks', "access_end TEXT NOT NULL DEFAULT ''");     // 권한 기간 종료
addColumn('audit_logs', 'ip TEXT');
addColumn('audit_logs', 'ua TEXT');

// 최초 실행 시 슈퍼관리자 계정과 기본 접근 시간(월~금 09:00~18:00)을 생성한다.
function seed() {
  const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role='superadmin'").get();
  if (row.c === 0) {
    const initialPw = process.env.SUPERADMIN_PASSWORD || 'ChangeMe123!';
    db.prepare(
      "INSERT INTO users (username, password_hash, name, role, must_change_password) VALUES (?, ?, ?, 'superadmin', 1)"
    ).run('superadmin', hashPassword(initialPw), '슈퍼관리자');
    console.log('====================================================');
    console.log('  최초 실행: 슈퍼관리자 계정이 생성되었습니다.');
    console.log(`  아이디: superadmin / 비밀번호: ${initialPw}`);
    console.log('  첫 로그인 시 비밀번호를 반드시 변경해야 합니다.');
    console.log('====================================================');
  }
  const sc = db.prepare('SELECT COUNT(*) AS c FROM schedules').get();
  if (sc.c === 0) {
    const ins = db.prepare('INSERT INTO schedules (day_of_week, start_time, end_time, enabled) VALUES (?, ?, ?, 1)');
    for (const dow of [1, 2, 3, 4, 5]) ins.run(dow, '09:00', '18:00');
  }
  // 보안 설정 기본값
  const defaults = {
    block_capture: '1', block_copy: '1', block_rightclick: '1', watermark: '1',
    devtools_detect: '1', single_session: '0', ip_restrict: '0', two_factor: '0',
    ip_allowlist: '',
  };
  const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) insSetting.run(k, v);
}

// 문자열 값을 갖는 설정 키 (나머지는 불리언 '1'/'0')
const STRING_SETTING_KEYS = new Set(['ip_allowlist']);

function getSettings() {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    out[row.key] = STRING_SETTING_KEYS.has(row.key) ? row.value : row.value === '1';
  }
  return out;
}

function setSetting(key, value) {
  const stored = STRING_SETTING_KEYS.has(key) ? String(value ?? '') : (value ? '1' : '0');
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, stored);
}
seed();

// req가 주어지면 접속 IP와 브라우저 정보를 함께 기록한다.
function log(user, action, detail = '', req = null) {
  let ip = null;
  let ua = null;
  if (req) {
    ip = clientIp(req);
    ua = String(req.headers['user-agent'] || '').slice(0, 200);
  }
  db.prepare('INSERT INTO audit_logs (user_id, username, action, detail, ip, ua) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user ? user.id : null, user ? user.username : null, action, String(detail).slice(0, 500), ip, ua);
}

function clientIp(req) {
  // 리버스 프록시 뒤에서는 TRUST_PROXY=1 설정 시 X-Forwarded-For의 첫 항목을 사용
  if (process.env.TRUST_PROXY === '1') {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

module.exports = { db, log, getSettings, setSetting, clientIp };
