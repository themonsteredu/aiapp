'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간

// 역할 서열: 숫자가 클수록 상위 권한
const ROLE_LEVEL = { student: 0, instructor: 1, admin: 2, superadmin: 3 };

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// 세션 토큰으로 사용자 조회. 만료/비활성 계정이면 null.
function getSessionUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(s.user_id);
  if (!user) return null;
  return { user, token };
}

function roleLevel(role) {
  return ROLE_LEVEL[role] ?? -1;
}

// 만료 세션 정리 (1시간마다)
setInterval(() => {
  try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); } catch {}
}, 60 * 60 * 1000).unref();

module.exports = { createSession, destroySession, getSessionUser, roleLevel, ROLE_LEVEL };
