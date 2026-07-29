'use strict';
const crypto = require('node:crypto');
const { q, one } = require('./db');

// 역할 서열: 숫자가 클수록 상위 권한
const ROLE_LEVEL = { student: 0, instructor: 1, admin: 2, superadmin: 3 };

// 세션 수명. 로그인 시점부터 고정 12시간이면 수업·작업 중에 그대로 끊긴다.
// 요청이 있을 때마다 남은 시간이 RENEW_BELOW_HOURS 아래로 내려가면 다시 12시간으로 늘린다(슬라이딩 세션).
// → 계속 쓰는 동안에는 절대 안 끊기고, 손을 뗀 지 11시간이 지나야 만료된다.
const SESSION_HOURS = 12;
const RENEW_BELOW_HOURS = 11;
const SESSION_MAX_AGE = SESSION_HOURS * 3600;

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await q(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`,
    [token, userId]
  );
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

// 세션 토큰으로 사용자 조회.
// 반환값이 null 이 아니면 renewed 플래그로 "쿠키를 다시 내려줘야 하는지"를 알려준다.
// 실패 시에는 이유(reason)를 함께 돌려줘서 클라이언트가 "로그인 필요"와 "세션 만료"를 구분할 수 있게 한다.
async function getSessionUser(req) {
  const token = parseCookies(req).session;
  if (!token) return { user: null, reason: 'no_session' };
  const s = await one('SELECT * FROM sessions WHERE token = $1 AND expires_at > now()', [token]);
  // 토큰은 있는데 세션 행이 없다 = 만료됐거나 다른 기기 로그인으로 밀렸다
  if (!s) return { user: null, reason: 'session_expired' };
  const user = await one('SELECT * FROM users WHERE id = $1 AND active = true', [s.user_id]);
  if (!user) return { user: null, reason: 'account_disabled' };

  // 게스트(입장 코드) 세션은 수업 종료 시각에 묶여 있으므로 여기서 늘리지 않는다.
  // 수업 세션 자체의 연장은 lib/api.js 의 게스트 처리에서 담당한다.
  let renewed = false;
  if (!user.guest_session_id) {
    const remainingMs = new Date(s.expires_at).getTime() - Date.now();
    if (remainingMs < RENEW_BELOW_HOURS * 3600 * 1000) {
      await q(
        `UPDATE sessions SET expires_at = now() + interval '${SESSION_HOURS} hours' WHERE token = $1`,
        [token]
      );
      renewed = true;
    }
  }
  return { user, token, renewed };
}

// 만료 세션 정리 (로그인 시마다 호출 — 서버리스 환경 대응)
async function cleanupSessions() {
  await q('DELETE FROM sessions WHERE expires_at < now()');
}

function roleLevel(role) {
  return ROLE_LEVEL[role] ?? -1;
}

module.exports = {
  createSession, destroySession, getSessionUser, cleanupSessions, roleLevel, ROLE_LEVEL,
  SESSION_HOURS, SESSION_MAX_AGE,
};
