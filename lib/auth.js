'use strict';
const crypto = require('node:crypto');
const { q, one } = require('./db');

// 역할 서열: 숫자가 클수록 상위 권한
// partner(진로업체 담당자)는 강사보다 낮다 — 강사용 API(minRole 'instructor')에 닿지 않는다.
// 학생용 경로도 열려 있으면 안 되므로 lib/api.js 디스패처의 PARTNER_ALLOW 목록으로 한 번 더 좁힌다.
const ROLE_LEVEL = { student: 0, partner: 0.5, instructor: 1, admin: 2, superadmin: 3 };

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '12 hours')", [token, userId]);
  return token;
}

async function destroySession(token) {
  await q('DELETE FROM sessions WHERE token = $1', [token]);
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
async function getSessionUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  // 모든 요청이 지나는 길이라 세션과 사용자를 한 번에 읽는다 (학생 폴링 1회당 왕복 1번 절약)
  const user = await one(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() AND u.active = true`,
    [token]
  );
  if (!user) return null;
  return { user, token };
}

// 만료 세션 정리 (로그인 시마다 호출 — 서버리스 환경 대응)
async function cleanupSessions() {
  await q('DELETE FROM sessions WHERE expires_at < now()');
}

function roleLevel(role) {
  return ROLE_LEVEL[role] ?? -1;
}

module.exports = { createSession, destroySession, getSessionUser, cleanupSessions, roleLevel, ROLE_LEVEL };
