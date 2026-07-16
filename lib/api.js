'use strict';
const crypto = require('node:crypto');
const { q, one, ready, log, getSettings, setSetting, clientIp, TS, KST_TODAY } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { createSession, destroySession, getSessionUser, cleanupSessions, roleLevel } = require('./auth');
const { checkAccess, toMinutes, todayInTimezone } = require('./schedule');
const { generateSecret, verifyTotp } = require('./totp');
const storage = require('./storage');

const ROLE_LABELS = { superadmin: '슈퍼관리자', admin: '관리자', instructor: '강사', student: '학생' };

// HTTPS 뒤에서 운영할 때 COOKIE_SECURE=1 (Vercel에서는 자동) 설정 시 세션 쿠키에 Secure 속성이 붙는다.
const COOKIE_SECURE = (process.env.COOKIE_SECURE === '1' || process.env.VERCEL) ? '; Secure' : '';

// 세션 쿠키 생성 헬퍼.
// SameSite=Lax 사용 이유: 학생이 카카오톡·구글클래스룸·QR 등 외부 링크로 앱을 다시 열면
// (교차 사이트 최상위 이동) SameSite=Strict 쿠키는 전송되지 않아 로그인 화면으로 튕긴다.
// Lax는 이런 최상위 GET 이동에는 쿠키를 실어 보내면서, 교차 사이트 POST(CSRF)에는 여전히 막아준다.
function sessionCookie(token, maxAgeSeconds) {
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${COOKIE_SECURE}`;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    roleLabel: ROLE_LABELS[u.role],
    className: u.class_name || '',
    active: !!u.active,
    mustChangePassword: !!u.must_change_password,
    totpEnabled: !!u.totp_enabled,
    isGuest: !!u.guest_session_id,
    agreedVersion: u.agreed_version || 0,
    createdAt: u.created_at,
    createdBy: u.created_by,
  };
}

// 강사·관리자는 최초/개정 시 계약·보안 동의를 완료해야 이용 가능
async function needsAgreement(user, settings) {
  // 학생·게스트는 대상 아님. 슈퍼관리자는 계약서를 발행하는 당사자이므로 동의 대상에서 제외(#5).
  if (user.role === 'student' || user.role === 'superadmin' || user.guest_session_id) return false;
  if (settings.agreement_required !== true && settings.agreement_required !== '1') return false;
  const ver = Number(settings.agreement_version || 1);
  return Number(user.agreed_version || 0) < ver;
}

// 수업 세션 요약 (게스트 응답용)
function publicClassSession(cs) {
  return {
    id: cs.id,
    title: cs.title,
    deckId: cs.deck_id,
    expiresAt: cs.expires_at,
  };
}

// 클라이언트에 내려보내는 설정: 서명 비밀키는 항상, IP 목록은 학생에게 숨김
function clientSettings(settings, user) {
  const out = { ...settings };
  delete out.gate_secret;
  if (!user || user.role === 'student') delete out.ip_allowlist;
  out.media_storage = storage.storageEnabled; // 대용량 동영상 업로드 가능 여부
  return out;
}

// IP 허용 목록 검사: 쉼표로 구분된 접두어(예: "211.43., 10.0.0.5") 중 하나로 시작하면 허용
function ipAllowed(ip, allowlist) {
  const rules = String(allowlist || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (rules.length === 0) return true;
  return rules.some((r) => ip.startsWith(r));
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function badRequest(res, message) { json(res, 400, { error: message }); }
function forbidden(res, message = '권한이 없습니다.') { json(res, 403, { error: message }); }
function notFound(res) { json(res, 404, { error: '찾을 수 없습니다.' }); }

// ---- 검증 헬퍼 ----
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
function validPassword(pw) { return typeof pw === 'string' && pw.length >= 8 && pw.length <= 100; }

// 계정 조회·수정·비활성·삭제 권한.
// - 슈퍼관리자: 모두 관리
// - 관리자: 강사·학생만 관리 (관리자 계정에 대한 권한은 슈퍼관리자 전용)
// - 강사: 자기보다 낮은 학생만
function canManage(actor, targetRole) {
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'admin') return targetRole === 'instructor' || targetRole === 'student';
  return roleLevel(actor.role) > roleLevel(targetRole);
}

// 역할 부여(계정 생성·역할 변경) 권한. 관리자 '임명'은 슈퍼관리자만 가능.
function canAssignRole(actor, role) {
  if (role === 'admin' || role === 'superadmin') return actor.role === 'superadmin';
  return roleLevel(actor.role) > roleLevel(role); // 강사·학생은 상위 역할이면 부여 가능
}

// ---- 라우트 테이블 ----
const routes = [];
function route(method, pattern, minRole, handler) {
  routes.push({ method, pattern, minRole, handler });
}

// 학생 시간제한 예외 경로
const STUDENT_EXEMPT = [
  /^\/api\/login$/, /^\/api\/logout$/, /^\/api\/me$/, /^\/api\/schedules$/,
  /^\/api\/report-capture$/, /^\/api\/password$/, /^\/api\/settings$/,
];

// 계약 동의 완료 전에도 허용되는 경로 (동의 화면·로그아웃·내정보·비번변경)
const AGREEMENT_EXEMPT = [
  /^\/api\/login$/, /^\/api\/logout$/, /^\/api\/me$/, /^\/api\/password$/,
  /^\/api\/agreement$/, /^\/api\/agree$/, /^\/api\/settings$/,
];

// 사용자 조회용 공통 SELECT (생성일을 표시 시간대 문자열로)
const USER_SELECT = `SELECT *, ${TS('created_at')} AS created_at FROM users`;

// ================= 인증 =================
route('POST', /^\/api\/login$/, null, async (req, res, ctx) => {
  const { username, password, otp } = ctx.body || {};
  if (!username || !password) return badRequest(res, '아이디와 비밀번호를 입력하세요.');
  const user = await one(`${USER_SELECT} WHERE username = $1`, [String(username).trim()]);
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    await log(user || null, 'login_failed', `username=${String(username).slice(0, 50)}`, req);
    return json(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  if (!user.active) {
    await log(user, 'login_blocked', '비활성 계정', req);
    return json(res, 403, { error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
  }
  const settings = await getSettings();

  // IP 제한: 학생 계정만 검사 (관리자 잠금 사고 방지)
  if (settings.ip_restrict && user.role === 'student') {
    const ip = clientIp(req);
    if (!ipAllowed(ip, settings.ip_allowlist)) {
      await log(user, 'ip_blocked', `ip=${ip}`, req);
      return json(res, 403, { error: '허용되지 않은 네트워크(IP)에서의 접속입니다.' });
    }
  }

  // 2단계 인증: 관리자 이상 계정에 적용
  if (settings.two_factor && roleLevel(user.role) >= roleLevel('admin')) {
    if (!user.totp_enabled) {
      let secret = user.totp_secret;
      if (!secret) {
        secret = generateSecret();
        await q('UPDATE users SET totp_secret = $1 WHERE id = $2', [secret, user.id]);
      }
      if (!otp) return json(res, 401, { needOtpSetup: true, secret, error: '2단계 인증 최초 등록이 필요합니다.' });
      if (!verifyTotp(secret, otp)) {
        await log(user, 'otp_failed', '2단계 인증 등록 코드 불일치', req);
        return json(res, 401, { needOtpSetup: true, secret, error: '인증 코드가 올바르지 않습니다.' });
      }
      await q('UPDATE users SET totp_enabled = true WHERE id = $1', [user.id]);
      await log(user, 'otp_enrolled', '2단계 인증 등록 완료', req);
    } else {
      if (!otp) return json(res, 401, { needOtp: true, error: '2단계 인증 코드를 입력하세요.' });
      if (!verifyTotp(user.totp_secret, otp)) {
        await log(user, 'otp_failed', '2단계 인증 코드 불일치', req);
        return json(res, 401, { needOtp: true, error: '인증 코드가 올바르지 않습니다.' });
      }
    }
  }

  // 동시접속 제한: 켜져 있으면 학생은 마지막 로그인 기기만 유지
  if (settings.single_session && user.role === 'student') {
    const existing = await one('SELECT count(*)::int AS c FROM sessions WHERE user_id = $1', [user.id]);
    if (existing.c > 0) await log(user, 'multi_session', `기존 세션 ${existing.c}개 종료`, req);
    await q('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  }
  await cleanupSessions();
  const token = await createSession(user.id);
  await log(user, 'login', '', req);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie(token, 12 * 3600),
  });
  res.end(JSON.stringify({
    user: publicUser(user), access: await checkAccess(),
    settings: clientSettings(settings, user), mustAgree: await needsAgreement(user, settings),
  }));
});

route('POST', /^\/api\/logout$/, 'student', async (req, res, ctx) => {
  await destroySession(ctx.token);
  await log(ctx.user, 'logout', '');
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie('', 0),
  });
  res.end(JSON.stringify({ ok: true }));
});

route('GET', /^\/api\/me$/, 'student', async (req, res, ctx) => {
  const settings = clientSettings(await getSettings(), ctx.user);
  // 게스트(입장 코드) 학생은 수업 세션이 유효한 동안 항상 접근 허용
  if (ctx.guestSession) {
    return json(res, 200, {
      user: publicUser(ctx.user),
      access: { allowed: true, guest: true, allowedDeckIds: null, now: (await checkAccess()).now, windows: [] },
      settings,
      classSession: publicClassSession(ctx.guestSession),
    });
  }
  json(res, 200, {
    user: publicUser(ctx.user), access: await checkAccess(), settings,
    mustAgree: await needsAgreement(ctx.user, await getSettings()),
  });
});

// ================= 계약·보안 동의 =================
route('GET', /^\/api\/agreement$/, 'instructor', async (req, res) => {
  const s = await getSettings();
  json(res, 200, { text: s.agreement_text || '', version: Number(s.agreement_version || 1) });
});

route('POST', /^\/api\/agree$/, 'instructor', async (req, res, ctx) => {
  const s = await getSettings();
  const version = Number(s.agreement_version || 1);
  const name = String(ctx.body?.name || '').trim().slice(0, 50);
  if (!ctx.body?.consent) return badRequest(res, '동의 체크가 필요합니다.');
  if (!name) return badRequest(res, '성명을 입력하세요.');
  await q('INSERT INTO agreements (user_id, version, signed_name, ip) VALUES ($1, $2, $3, $4)',
    [ctx.user.id, version, name, clientIp(req)]);
  await q('UPDATE users SET agreed_version = $1 WHERE id = $2', [version, ctx.user.id]);
  await log(ctx.user, 'agreement_signed', `v${version} 서명=${name}`, req);
  json(res, 200, { ok: true });
});

// 계약 문서 관리 (슈퍼관리자): 조회·수정(개정 시 버전 증가 → 전원 재동의)
route('GET', /^\/api\/agreement\/admin$/, 'superadmin', async (req, res) => {
  const s = await getSettings();
  const records = await q(
    `SELECT a.*, ${TS('a.agreed_at')} AS agreed_at, u.username, u.name, u.role
     FROM agreements a JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200`
  );
  const pending = await q(
    `SELECT username, name, role FROM users
     WHERE role IN ('instructor','admin') AND active = true AND agreed_version < $1`,
    [Number(s.agreement_version || 1)]
  );
  json(res, 200, {
    text: s.agreement_text || '', version: Number(s.agreement_version || 1),
    required: s.agreement_required === true || s.agreement_required === '1',
    records, pending,
  });
});

route('PATCH', /^\/api\/agreement\/admin$/, 'superadmin', async (req, res, ctx) => {
  const { text, required, bump } = ctx.body || {};
  if (text !== undefined) await setSetting('agreement_text', String(text).slice(0, 20000));
  if (required !== undefined) await setSetting('agreement_required', required ? '1' : '0');
  if (bump) {
    const s = await getSettings();
    await setSetting('agreement_version', String(Number(s.agreement_version || 1) + 1));
    await log(ctx.user, 'agreement_revised', '계약 개정 — 전원 재동의 필요', req);
  }
  json(res, 200, { ok: true });
});

// ================= 수업 입장 코드 (1회성 학생) =================
// 학생 입장: 코드 + 이름만으로 임시 계정과 세션을 발급한다. 수업 만료와 함께 소멸.
route('POST', /^\/api\/join$/, null, async (req, res, ctx) => {
  const { code, name } = ctx.body || {};
  const cleanName = String(name || '').trim().slice(0, 30);
  if (!/^\d{6}$/.test(String(code || '').trim())) return badRequest(res, '입장 코드는 6자리 숫자입니다.');
  if (!cleanName) return badRequest(res, '이름을 입력하세요.');
  const cs = await one('SELECT * FROM class_sessions WHERE code = $1', [String(code).trim()]);
  if (!cs || !cs.active || new Date(cs.expires_at) <= new Date()) {
    await log(null, 'join_failed', `code=${String(code).slice(0, 10)} name=${cleanName}`, req);
    return json(res, 404, { error: '유효하지 않거나 종료된 입장 코드입니다.' });
  }
  // 임시 학생 계정 생성 (비밀번호는 사용되지 않는 무작위 값)
  const username = `guest${cs.id}-${crypto.randomBytes(3).toString('hex')}`;
  const u = await one(
    `INSERT INTO users (username, password_hash, name, role, class_name, created_by, guest_session_id)
     VALUES ($1, $2, $3, 'student', $4, $5, $6) RETURNING *, ${TS('created_at')} AS created_at`,
    [username, hashPassword(crypto.randomBytes(16).toString('hex')), cleanName, cs.title.slice(0, 50), cs.created_by, cs.id]
  );
  // 접속 세션은 수업 종료 시각까지만 유효
  const token = crypto.randomBytes(32).toString('hex');
  await q('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, u.id, cs.expires_at]);
  await log(u, 'guest_joined', `code=${cs.code} 수업=${cs.title}`, req);
  const settings = clientSettings(await getSettings(), u);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': sessionCookie(token, 12 * 3600),
  });
  res.end(JSON.stringify({
    user: publicUser(u),
    access: { allowed: true, guest: true, allowedDeckIds: null, now: (await checkAccess()).now, windows: [] },
    settings,
    classSession: publicClassSession(cs),
  }));
});

// 수업 세션 관리 권한: 관리자 이상은 전체, 강사는 자기가 만들었거나 배정받은 수업
function canManageSession(user, cs) {
  return roleLevel(user.role) >= roleLevel('admin')
    || cs.created_by === user.id
    || cs.instructor_id === user.id;
}

// 만료된 지 1일 지난 수업의 게스트 계정 자동 정리 (접속 기록은 보존)
async function pruneGuests() {
  await q(`DELETE FROM sessions WHERE user_id IN (
    SELECT u.id FROM users u JOIN class_sessions cs ON cs.id = u.guest_session_id
    WHERE cs.expires_at < now() - interval '1 day')`);
  await q(`DELETE FROM users WHERE guest_session_id IN (
    SELECT id FROM class_sessions WHERE expires_at < now() - interval '1 day')`);
}

route('GET', /^\/api\/class-sessions$/, 'instructor', async (req, res, ctx) => {
  await pruneGuests();
  const rows = await q(
    `SELECT cs.*, ${TS('cs.created_at')} AS created_at, ${TS('cs.expires_at')} AS expires_text,
       d.title AS deck_title, ins.name AS instructor_name,
       (SELECT count(*)::int FROM users u WHERE u.guest_session_id = cs.id) AS joined,
       (SELECT count(*)::int FROM session_items si WHERE si.session_id = cs.id) AS item_count
     FROM class_sessions cs
       LEFT JOIN decks d ON d.id = cs.deck_id
       LEFT JOIN users ins ON ins.id = cs.instructor_id
     ${roleLevel(ctx.user.role) >= roleLevel('admin') ? '' : 'WHERE cs.created_by = $1 OR cs.instructor_id = $1'}
     ORDER BY cs.id DESC LIMIT 50`,
    roleLevel(ctx.user.role) >= roleLevel('admin') ? [] : [ctx.user.id]
  );
  const nowMs = Date.now();
  json(res, 200, {
    sessions: rows.map((cs) => ({
      ...cs,
      status: !cs.active ? 'ended' : (new Date(cs.expires_at).getTime() <= nowMs ? 'expired' : 'live'),
      remainingMinutes: Math.max(0, Math.round((new Date(cs.expires_at).getTime() - nowMs) / 60000)),
    })),
  });
});

route('POST', /^\/api\/class-sessions$/, 'instructor', async (req, res, ctx) => {
  const { title, deck_id, deck_ids, duration_minutes, instructor_id } = ctx.body || {};
  if (!title || !String(title).trim()) return badRequest(res, '수업명을 입력하세요.');
  const minutes = Math.min(1440, Math.max(15, Number(duration_minutes) || 120));
  // 단일 지정(하위호환) 또는 자료 여러 개(deck_ids). deck_ids가 있으면 session_items로 담는다.
  let deckId = null;
  if (deck_id !== undefined && deck_id !== null && deck_id !== '') {
    const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(deck_id)]);
    if (!deck) return badRequest(res, '존재하지 않는 웹앱입니다.');
    deckId = deck.id;
  }
  // 담당 강사 배정: 관리자 이상만 지정 가능. 담당자는 강사 또는 관리자(수업 담당 관리자)일 수 있음
  let instructorId = ctx.user.id;
  if (roleLevel(ctx.user.role) >= roleLevel('admin') && instructor_id) {
    const ins = await one("SELECT id FROM users WHERE id = $1 AND active = true AND role IN ('instructor','admin','superadmin')", [Number(instructor_id)]);
    if (!ins) return badRequest(res, '존재하지 않는 담당자입니다.');
    instructorId = ins.id;
  }
  // 6자리 코드 발급 (충돌 시 재시도)
  let cs = null;
  for (let i = 0; i < 10 && !cs; i++) {
    const code = String(crypto.randomInt(100000, 1000000));
    try {
      cs = await one(
        `INSERT INTO class_sessions (code, title, deck_id, created_by, instructor_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' minutes')::interval) RETURNING *`,
        [code, String(title).trim().slice(0, 100), deckId, ctx.user.id, instructorId, minutes]
      );
    } catch (e) {
      if (!String(e.message).includes('duplicate key')) throw e;
    }
  }
  if (!cs) return json(res, 500, { error: '코드 발급에 실패했습니다. 다시 시도하세요.' });
  if (Array.isArray(deck_ids) && deck_ids.length) {
    let pos = 0;
    for (const did of deck_ids) {
      const deck = await one('SELECT id FROM decks WHERE id = $1', [Number(did)]);
      if (deck) {
        await q('INSERT INTO session_items (session_id, deck_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [cs.id, deck.id, pos++]);
      }
    }
  }
  await log(ctx.user, 'session_created', `code=${cs.code} 수업=${cs.title} ${minutes}분`, req);
  json(res, 200, { ok: true, id: cs.id, code: cs.code });
});

// ---- 수업 자료 목록 관리 (여러 자료 + 학생 공개/잠금 개별 제어) ----
route('GET', /^\/api\/class-sessions\/(\d+)\/items$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  const items = await q(
    `SELECT si.*, d.title AS deck_title, d.kind
     FROM session_items si JOIN decks d ON d.id = si.deck_id
     WHERE si.session_id = $1 ORDER BY si.position, si.id`,
    [cs.id]
  );
  json(res, 200, { items });
});

route('POST', /^\/api\/class-sessions\/(\d+)\/items$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  const deck = await one('SELECT id FROM decks WHERE id = $1', [Number(ctx.body?.deck_id)]);
  if (!deck) return badRequest(res, '존재하지 않는 자료입니다.');
  const pos = (await one('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM session_items WHERE session_id = $1', [cs.id])).p;
  try {
    await q('INSERT INTO session_items (session_id, deck_id, position) VALUES ($1, $2, $3)', [cs.id, deck.id, pos]);
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return badRequest(res, '이미 담긴 자료입니다.');
    throw e;
  }
  json(res, 200, { ok: true });
});

route('PATCH', /^\/api\/class-sessions\/(\d+)\/items\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  const item = await one('SELECT * FROM session_items WHERE id = $1 AND session_id = $2', [Number(ctx.params[1]), cs.id]);
  if (!item) return notFound(res);
  const { student_visible, unlocked } = ctx.body || {};
  if (student_visible !== undefined) {
    await q('UPDATE session_items SET student_visible = $1 WHERE id = $2', [!!student_visible, item.id]);
  }
  if (unlocked !== undefined) {
    await q('UPDATE session_items SET unlocked = $1 WHERE id = $2', [!!unlocked, item.id]);
    await log(ctx.user, unlocked ? 'item_unlocked' : 'item_locked', `수업=${cs.title} 자료ID=${item.deck_id}`, req);
  }
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/class-sessions\/(\d+)\/items\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  await q('DELETE FROM session_items WHERE id = $1 AND session_id = $2', [Number(ctx.params[1]), cs.id]);
  json(res, 200, { ok: true });
});

// 수업 종료: 코드 비활성화 + 접속 중인 게스트 즉시 차단
route('PATCH', /^\/api\/class-sessions\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  await q('UPDATE class_sessions SET active = false WHERE id = $1', [cs.id]);
  await q('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE guest_session_id = $1)', [cs.id]);
  await log(ctx.user, 'session_ended', `code=${cs.code} 수업=${cs.title}`, req);
  json(res, 200, { ok: true });
});

// ---- 라이브 발표 (강사가 넘기면 학생 화면이 따라옴) ----
// 학생(게스트)이 3초 간격으로 폴링하는 현재 상태 조회
route('GET', /^\/api\/class-sessions\/(\d+)\/live$/, 'student', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  const isMember = ctx.user.guest_session_id === cs.id;
  const isManager = roleLevel(ctx.user.role) >= roleLevel('instructor') && canManageSession(ctx.user, cs);
  if (!isMember && !isManager) return forbidden(res);
  json(res, 200, {
    live: cs.live_deck_id ? { deckId: cs.live_deck_id, slide: cs.live_slide } : null,
  });
});

// 강사 제어: 슬라이드 이동 시마다 호출, {deck_id:null}이면 라이브 종료
route('PATCH', /^\/api\/class-sessions\/(\d+)\/live$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  const { deck_id, slide } = ctx.body || {};
  if (!deck_id) {
    await q('UPDATE class_sessions SET live_deck_id = NULL, live_slide = 0 WHERE id = $1', [cs.id]);
    if (cs.live_deck_id) await log(ctx.user, 'live_ended', `수업=${cs.title}`, req);
    return json(res, 200, { ok: true });
  }
  const deckId = Number(deck_id);
  // 수업 자료 목록이 있으면 그 안의 자료만, 없으면 단일 지정과 일치해야 함
  const items = await q('SELECT deck_id FROM session_items WHERE session_id = $1', [cs.id]);
  if (items.length) {
    if (!items.some((i) => i.deck_id === deckId)) {
      return badRequest(res, '이 수업에 담긴 자료만 라이브로 발표할 수 있습니다.');
    }
  } else if (cs.deck_id && deckId !== cs.deck_id) {
    return badRequest(res, '이 수업에 지정된 웹앱만 라이브로 발표할 수 있습니다.');
  }
  const deck = await one("SELECT * FROM decks WHERE id = $1 AND kind = 'slides'", [deckId]);
  if (!deck) return badRequest(res, '라이브 발표는 슬라이드형 웹앱만 가능합니다.');
  const slideIdx = Math.max(0, Number(slide) || 0);
  await q('UPDATE class_sessions SET live_deck_id = $1, live_slide = $2 WHERE id = $3', [deckId, slideIdx, cs.id]);
  if (!cs.live_deck_id) await log(ctx.user, 'live_started', `수업=${cs.title} deck=${deckId}`, req);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/class-sessions\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const cs = await one('SELECT * FROM class_sessions WHERE id = $1', [Number(ctx.params[0])]);
  if (!cs) return notFound(res);
  if (!canManageSession(ctx.user, cs)) return forbidden(res);
  await q('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE guest_session_id = $1)', [cs.id]);
  await q('DELETE FROM users WHERE guest_session_id = $1', [cs.id]);
  await q('DELETE FROM class_sessions WHERE id = $1', [cs.id]);
  await log(ctx.user, 'session_deleted', `code=${cs.code} 수업=${cs.title}`, req);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/password$/, 'student', async (req, res, ctx) => {
  const { current, next } = ctx.body || {};
  if (!verifyPassword(String(current || ''), ctx.user.password_hash)) {
    return badRequest(res, '현재 비밀번호가 올바르지 않습니다.');
  }
  if (!validPassword(next)) return badRequest(res, '새 비밀번호는 8자 이상이어야 합니다.');
  await q('UPDATE users SET password_hash = $1, must_change_password = false WHERE id = $2', [hashPassword(next), ctx.user.id]);
  await log(ctx.user, 'password_changed', '');
  json(res, 200, { ok: true });
});

// ================= 사용자 관리 =================
route('GET', /^\/api\/users$/, 'instructor', async (req, res, ctx) => {
  // 게스트(1회성) 계정은 사용자 관리 목록에서 제외 — 수업 코드 화면에서 인원만 확인
  const all = await q(`${USER_SELECT} WHERE guest_session_id IS NULL ORDER BY role, username`);
  // 관리자 이상은 전체 조회(운영 권한 동일), 강사는 관리 가능한 계정만
  const visible = roleLevel(ctx.user.role) >= roleLevel('admin')
    ? all
    : all.filter((u) => canManage(ctx.user, u.role));
  json(res, 200, { users: visible.map((u) => ({ ...publicUser(u), manageable: u.id !== ctx.user.id && canManage(ctx.user, u.role) })) });
});

route('POST', /^\/api\/users$/, 'instructor', async (req, res, ctx) => {
  const { username, name, role, password, class_name } = ctx.body || {};
  if (!USERNAME_RE.test(String(username || ''))) {
    return badRequest(res, '아이디는 3~30자의 영문/숫자/._- 만 가능합니다.');
  }
  if (!name || String(name).trim().length === 0) return badRequest(res, '이름을 입력하세요.');
  if (!ROLE_LABELS[role]) return badRequest(res, '올바르지 않은 역할입니다.');
  if (!canAssignRole(ctx.user, role)) {
    return forbidden(res, role === 'admin' ? '관리자 계정은 슈퍼관리자만 만들 수 있습니다.' : '해당 권한의 계정을 만들 수 없습니다.');
  }
  if (!validPassword(password)) return badRequest(res, '비밀번호는 8자 이상이어야 합니다.');
  try {
    const r = await one(
      `INSERT INTO users (username, password_hash, name, role, created_by, must_change_password, class_name)
       VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
      [String(username).trim(), hashPassword(String(password)), String(name).trim(), role, ctx.user.id,
        role === 'student' ? String(class_name || '').trim().slice(0, 50) : '']
    );
    await log(ctx.user, 'user_created', `id=${r.id} username=${username} role=${role}`, req);
    json(res, 200, { ok: true, id: r.id });
  } catch (e) {
    if (String(e.message).includes('duplicate key')) return badRequest(res, '이미 존재하는 아이디입니다.');
    throw e;
  }
});

route('PATCH', /^\/api\/users\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const target = await one('SELECT * FROM users WHERE id = $1', [Number(ctx.params[0])]);
  if (!target) return notFound(res);
  if (!canManage(ctx.user, target.role)) return forbidden(res);
  const { active, name, role, class_name } = ctx.body || {};
  if (class_name !== undefined) {
    await q('UPDATE users SET class_name = $1 WHERE id = $2', [String(class_name).trim().slice(0, 50), target.id]);
  }
  if (role !== undefined) {
    if (!ROLE_LABELS[role] || !canAssignRole(ctx.user, role)) return forbidden(res, '해당 역할로 변경할 권한이 없습니다.');
    await q('UPDATE users SET role = $1 WHERE id = $2', [role, target.id]);
  }
  if (active !== undefined) {
    await q('UPDATE users SET active = $1 WHERE id = $2', [!!active, target.id]);
    if (!active) await q('DELETE FROM sessions WHERE user_id = $1', [target.id]);
  }
  if (name !== undefined && String(name).trim()) {
    await q('UPDATE users SET name = $1 WHERE id = $2', [String(name).trim(), target.id]);
  }
  await log(ctx.user, 'user_updated', `id=${target.id} ${JSON.stringify(ctx.body).slice(0, 200)}`, req);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/users\/(\d+)\/reset-password$/, 'instructor', async (req, res, ctx) => {
  const target = await one('SELECT * FROM users WHERE id = $1', [Number(ctx.params[0])]);
  if (!target) return notFound(res);
  if (!canManage(ctx.user, target.role)) return forbidden(res);
  const { password } = ctx.body || {};
  if (!validPassword(password)) return badRequest(res, '비밀번호는 8자 이상이어야 합니다.');
  await q('UPDATE users SET password_hash = $1, must_change_password = true WHERE id = $2', [hashPassword(String(password)), target.id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [target.id]);
  await log(ctx.user, 'password_reset', `target=${target.username}`, req);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/users\/(\d+)$/, 'admin', async (req, res, ctx) => {
  const target = await one('SELECT * FROM users WHERE id = $1', [Number(ctx.params[0])]);
  if (!target) return notFound(res);
  if (!canManage(ctx.user, target.role)) return forbidden(res);
  await q('DELETE FROM sessions WHERE user_id = $1', [target.id]);
  await q('DELETE FROM users WHERE id = $1', [target.id]);
  await log(ctx.user, 'user_deleted', `target=${target.username}`, req);
  json(res, 200, { ok: true });
});

// ================= 접근 시간표 =================
route('GET', /^\/api\/schedules$/, 'student', async (req, res) => {
  json(res, 200, await checkAccess());
});

route('POST', /^\/api\/schedules$/, 'admin', async (req, res, ctx) => {
  const { day_of_week, start_time, end_time, deck_id } = ctx.body || {};
  const dow = Number(day_of_week);
  const start = toMinutes(String(start_time || ''));
  const end = toMinutes(String(end_time || ''));
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return badRequest(res, '요일이 올바르지 않습니다.');
  if (start === null || end === null) return badRequest(res, '시간 형식은 HH:MM 입니다.');
  if (start >= end) return badRequest(res, '시작 시간은 종료 시간보다 빨라야 합니다.');
  let deckId = null;
  if (deck_id !== undefined && deck_id !== null && deck_id !== '') {
    const deck = await one('SELECT id FROM decks WHERE id = $1', [Number(deck_id)]);
    if (!deck) return badRequest(res, '존재하지 않는 웹앱입니다.');
    deckId = deck.id;
  }
  const r = await one(
    'INSERT INTO schedules (day_of_week, start_time, end_time, deck_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [dow, start_time, end_time, deckId]
  );
  await log(ctx.user, 'schedule_created', `${dow} ${start_time}-${end_time} deck=${deckId ?? '전체'}`, req);
  json(res, 200, { ok: true, id: r.id });
});

route('PATCH', /^\/api\/schedules\/(\d+)$/, 'admin', async (req, res, ctx) => {
  const s = await one('SELECT * FROM schedules WHERE id = $1', [Number(ctx.params[0])]);
  if (!s) return notFound(res);
  const { enabled } = ctx.body || {};
  if (enabled !== undefined) {
    await q('UPDATE schedules SET enabled = $1 WHERE id = $2', [!!enabled, s.id]);
  }
  await log(ctx.user, 'schedule_updated', `id=${s.id} enabled=${enabled}`, req);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/schedules\/(\d+)$/, 'admin', async (req, res, ctx) => {
  await q('DELETE FROM schedules WHERE id = $1', [Number(ctx.params[0])]);
  await log(ctx.user, 'schedule_deleted', `id=${ctx.params[0]}`, req);
  json(res, 200, { ok: true });
});

// ================= 덱(PPT) =================
// 배정 상태: 비공개 / 예약(기간 전) / 만료(기간 후) / 공개 중
function deckStatus(d, today) {
  if (!d.published) return 'private';
  if (d.access_start && today < d.access_start) return 'scheduled';
  if (d.access_end && today > d.access_end) return 'expired';
  return 'live';
}

// 덱 + 소유자 이름 + 슬라이드 수를 한 번에 조회
const DECK_SELECT = `
  SELECT d.*, ${TS('d.created_at')} AS created_at, ${TS('d.updated_at')} AS updated_at,
    COALESCE(u.name, '?') AS owner_name,
    (SELECT count(*)::int FROM slides s WHERE s.deck_id = d.id) AS slide_count
  FROM decks d LEFT JOIN users u ON u.id = d.created_by`;

function deckWithMeta(d) {
  return {
    ...d, published: !!d.published, slideCount: d.slide_count, ownerName: d.owner_name,
    status: deckStatus(d, todayInTimezone()),
    deletePending: !!d.delete_pending,
    costType: d.cost_type || 'free', apiProvider: d.api_provider || '', unitCost: Number(d.unit_cost || 0),
  };
}

// 사용 귀속: 어느 수업(session)·어느 강사에게 이 사용을 달아줄지 결정
//  - 게스트(입장 코드) 사용: 그 수업 + 담당 강사(instructor_id, 없으면 개설자)
//  - 그 외(일반 학생 등): 수업 없음 + 자료 소유 강사(created_by)
function attributeUsage(deck, guestSession) {
  if (guestSession) {
    return { sessionId: guestSession.id, instructorId: guestSession.instructor_id || guestSession.created_by || null };
  }
  return { sessionId: null, instructorId: deck.created_by || null };
}

// 종량 계측: API 유료 자료만 usage_events에 적재 (무료는 기록 안 함)
async function recordUsage(deck, user, guestSession, { kind = 'open', calls = 1 } = {}) {
  if (!deck || deck.cost_type !== 'api_paid') return;
  const { sessionId, instructorId } = attributeUsage(deck, guestSession);
  await q(
    `INSERT INTO usage_events (deck_id, user_id, is_guest, session_id, instructor_id, calls, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [deck.id, user ? user.id : null, !!guestSession, sessionId, instructorId, Math.max(1, Math.min(10000, Math.round(calls) || 1)), kind]
  );
}

// 요금 유형 입력 정규화
const COST_TYPES = new Set(['free', 'api_paid']);
function normalizeCost(body, cur = {}) {
  const out = {};
  if (body.cost_type !== undefined) out.cost_type = COST_TYPES.has(body.cost_type) ? body.cost_type : 'free';
  if (body.api_provider !== undefined) out.api_provider = String(body.api_provider || '').trim().slice(0, 50);
  if (body.unit_cost !== undefined) out.unit_cost = Math.max(0, Math.min(10_000_000, Math.round(Number(body.unit_cost) || 0)));
  return out;
}

// 학생에게 보이는 덱: 공개 + 권한 기간 내 + (대상 반이 지정됐다면 자기 반 포함)
function deckVisibleToStudent(d, student, today) {
  if (deckStatus(d, today) !== 'live') return false;
  const classes = String(d.target_classes || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (classes.length > 0 && !classes.includes(student.class_name || '')) return false;
  return true;
}

// 강사는 자기 덱만 수정, 관리자 이상은 전체 수정 가능
function canEditDeck(user, deck) {
  return roleLevel(user.role) >= roleLevel('admin') || deck.created_by === user.id;
}

// 삭제 권한(#1): 슈퍼관리자는 전체, 그 외에는 본인이 올린 자료만
function canDeleteDeck(user, deck) {
  return user.role === 'superadmin' || deck.created_by === user.id;
}

// 게스트(입장 코드) 학생의 특정 덱 접근 판정.
// 우선순위: 수업 자료 목록(session_items) > 단일 지정(deck_id) > 공개 전체
//   listed  = 학생 목록에 보이는가
//   allowed = 지금 열 수 있는가 (보이면서 잠금 해제)
async function guestDeckAccess(cs, deckId) {
  const items = await q('SELECT * FROM session_items WHERE session_id = $1', [cs.id]);
  if (items.length) {
    const it = items.find((i) => i.deck_id === Number(deckId));
    if (!it) return { listed: false, allowed: false, locked: false };
    return { listed: it.student_visible, allowed: it.student_visible && it.unlocked, locked: !it.unlocked };
  }
  if (cs.deck_id) {
    const ok = cs.deck_id === Number(deckId);
    return { listed: ok, allowed: ok, locked: false };
  }
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(deckId)]);
  const live = deck && deckStatus(deck, todayInTimezone()) === 'live';
  return { listed: live, allowed: live, locked: false };
}

route('GET', /^\/api\/decks$/, 'student', async (req, res, ctx) => {
  // 게스트: 수업 자료 목록 우선 (학생 공개 항목만, 잠금 상태 포함)
  if (ctx.guestSession) {
    const cs = ctx.guestSession;
    const items = await q('SELECT * FROM session_items WHERE session_id = $1 ORDER BY position, id', [cs.id]);
    if (items.length) {
      const decks = [];
      for (const it of items.filter((i) => i.student_visible)) {
        const d = await one(`${DECK_SELECT} WHERE d.id = $1`, [it.deck_id]);
        if (d) decks.push({ ...deckWithMeta(d), accessibleNow: it.unlocked, locked: !it.unlocked });
      }
      return json(res, 200, { decks });
    }
    // 하위호환: 단일 지정 또는 공개 전체
    let rows;
    if (cs.deck_id) {
      rows = await q(`${DECK_SELECT} WHERE d.id = $1`, [cs.deck_id]);
    } else {
      const today = todayInTimezone();
      rows = (await q(`${DECK_SELECT} WHERE d.published = true ORDER BY d.updated_at DESC`))
        .filter((d) => deckStatus(d, today) === 'live');
    }
    return json(res, 200, { decks: rows.map((d) => ({ ...deckWithMeta(d), accessibleNow: true })) });
  }
  if (ctx.user.role === 'student') {
    const today = todayInTimezone();
    const rows = (await q(`${DECK_SELECT} WHERE d.published = true ORDER BY d.updated_at DESC`))
      .filter((d) => deckVisibleToStudent(d, ctx.user, today));
    const access = await checkAccess();
    const decks = rows.map((d) => ({
      ...deckWithMeta(d),
      accessibleNow: access.allowedDeckIds === null || access.allowedDeckIds.includes(d.id),
    }));
    return json(res, 200, { decks });
  }
  // 강사: 내가 만든 자료 + 내 수업(직접 만든/배정받은)에 담긴 자료
  //       + 배정된 과정의 필수 자료 + 내가 담은 선택 자료
  if (ctx.user.role === 'instructor') {
    const rows = await q(
      `${DECK_SELECT}
       WHERE d.created_by = $1
          OR d.id IN (SELECT si.deck_id FROM session_items si JOIN class_sessions cs ON cs.id = si.session_id
                      WHERE cs.created_by = $1 OR cs.instructor_id = $1)
          OR d.id IN (SELECT ci.deck_id FROM course_items ci
                      JOIN course_instructors cin ON cin.course_id = ci.course_id
                      WHERE cin.instructor_id = $1 AND ci.required = true)
          OR d.id IN (SELECT deck_id FROM course_opt_ins WHERE instructor_id = $1)
       ORDER BY d.updated_at DESC`,
      [ctx.user.id]
    );
    return json(res, 200, { decks: rows.map((d) => ({ ...deckWithMeta(d), editable: canEditDeck(ctx.user, d), canDelete: canDeleteDeck(ctx.user, d) })) });
  }
  // 관리자 이상: 전체
  const rows = await q(`${DECK_SELECT} ORDER BY d.updated_at DESC`);
  json(res, 200, { decks: rows.map((d) => ({ ...deckWithMeta(d), editable: canEditDeck(ctx.user, d), canDelete: canDeleteDeck(ctx.user, d) })) });
});

const URL_RE = /^https:\/\/[^\s<>"']+$/;

// HTML 웹앱 파일 검증 (3MB 이하 — Vercel 요청 한도 고려)
function validHtml(html) {
  const s = String(html || '');
  return s.trim().length > 0 && s.length <= 3_000_000;
}

route('POST', /^\/api\/decks$/, 'instructor', async (req, res, ctx) => {
  const { title, description, subject, kind, external_url, html } = ctx.body || {};
  if (!title || !String(title).trim()) return badRequest(res, '제목을 입력하세요.');
  const deckKind = ['link', 'html'].includes(kind) ? kind : 'slides';
  let url = '';
  if (deckKind === 'link') {
    url = String(external_url || '').trim();
    if (!URL_RE.test(url)) return badRequest(res, '외부 웹앱 주소는 https:// 로 시작해야 합니다.');
  }
  if (deckKind === 'html' && !validHtml(html)) {
    return badRequest(res, 'HTML 파일이 비었거나 너무 큽니다. (3MB 이하)');
  }
  const cost = normalizeCost(ctx.body || {});
  const r = await one(
    `INSERT INTO decks (title, description, subject, created_by, kind, external_url, cost_type, api_provider, unit_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [String(title).trim(), String(description || '').trim(), String(subject || '').trim().slice(0, 50), ctx.user.id, deckKind, url,
     cost.cost_type || 'free', cost.api_provider || '', cost.unit_cost || 0]
  );
  // 슬라이드형은 빈 덱으로 시작 — 편집기에서 PPT 이미지·동영상 슬라이드를 추가한다 (마크다운 직접 작성 없음)
  if (deckKind === 'html') {
    await q("INSERT INTO assets (deck_id, mime, data, created_by) VALUES ($1, 'text/html', $2, $3)",
      [r.id, Buffer.from(String(html), 'utf-8').toString('base64'), ctx.user.id]);
  }
  await log(ctx.user, 'deck_created', `id=${r.id} title=${title} kind=${deckKind}`, req);
  json(res, 200, { ok: true, id: r.id });
});

route('GET', /^\/api\/decks\/(\d+)$/, 'student', async (req, res, ctx) => {
  const deck = await one(`${DECK_SELECT} WHERE d.id = $1`, [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (ctx.guestSession) {
    const acc = await guestDeckAccess(ctx.guestSession, deck.id);
    if (!acc.listed) return forbidden(res, '이 수업에서 열람할 수 없는 자료입니다.');
    if (acc.locked) return forbidden(res, '아직 잠겨 있는 자료입니다. 선생님이 열어주면 이용할 수 있어요.');
    await log(ctx.user, 'deck_viewed', `id=${deck.id} title=${deck.title}`, req);
    await recordUsage(deck, ctx.user, ctx.guestSession);
    const slides = await q('SELECT * FROM slides WHERE deck_id = $1 ORDER BY position, id', [deck.id]);
    return json(res, 200, { deck: deckWithMeta(deck), slides, canEdit: false });
  }
  if (ctx.user.role === 'student') {
    if (!deckVisibleToStudent(deck, ctx.user, todayInTimezone())) {
      return forbidden(res, '열람 권한이 없는 자료입니다.');
    }
    const access = await checkAccess(deck.id);
    if (!access.allowed) {
      await log(ctx.user, 'time_blocked', `deck=${deck.id}`, req);
      return json(res, 403, { error: 'time_blocked', message: '이 웹앱은 지금 접근이 허용된 시간이 아닙니다.', access });
    }
    await log(ctx.user, 'deck_viewed', `id=${deck.id} title=${deck.title}`, req);
    await recordUsage(deck, ctx.user, null);
  }
  const slides = await q('SELECT * FROM slides WHERE deck_id = $1 ORDER BY position, id', [deck.id]);
  json(res, 200, { deck: deckWithMeta(deck), slides, canEdit: ctx.user.role !== 'student' && canEditDeck(ctx.user, deck) });
});

route('PATCH', /^\/api\/decks\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { title, description, published, target_classes, access_start, access_end, subject, external_url } = ctx.body || {};
  if (title !== undefined && String(title).trim()) {
    await q('UPDATE decks SET title = $1 WHERE id = $2', [String(title).trim(), deck.id]);
  }
  if (subject !== undefined) {
    await q('UPDATE decks SET subject = $1 WHERE id = $2', [String(subject).trim().slice(0, 50), deck.id]);
  }
  if (external_url !== undefined && deck.kind === 'link') {
    const url = String(external_url).trim();
    if (!URL_RE.test(url)) return badRequest(res, '외부 웹앱 주소는 https:// 로 시작해야 합니다.');
    await q('UPDATE decks SET external_url = $1 WHERE id = $2', [url, deck.id]);
  }
  // HTML 웹앱 파일 교체
  if (ctx.body?.html !== undefined && deck.kind === 'html') {
    if (!validHtml(ctx.body.html)) return badRequest(res, 'HTML 파일이 비었거나 너무 큽니다. (3MB 이하)');
    await q("DELETE FROM assets WHERE deck_id = $1 AND mime = 'text/html'", [deck.id]);
    await q("INSERT INTO assets (deck_id, mime, data, created_by) VALUES ($1, 'text/html', $2, $3)",
      [deck.id, Buffer.from(String(ctx.body.html), 'utf-8').toString('base64'), ctx.user.id]);
  }
  if (description !== undefined) {
    await q('UPDATE decks SET description = $1 WHERE id = $2', [String(description).trim(), deck.id]);
  }
  if (published !== undefined) {
    await q('UPDATE decks SET published = $1 WHERE id = $2', [!!published, deck.id]);
  }
  if (target_classes !== undefined) {
    await q('UPDATE decks SET target_classes = $1 WHERE id = $2', [String(target_classes).trim().slice(0, 300), deck.id]);
  }
  // 요금 유형 (무료 / API 유료)
  const cost = normalizeCost(ctx.body || {});
  for (const [col, val] of Object.entries(cost)) {
    await q(`UPDATE decks SET ${col} = $1 WHERE id = $2`, [val, deck.id]);
  }
  const DATE_RE = /^(\d{4}-\d{2}-\d{2})?$/;
  if (access_start !== undefined && DATE_RE.test(String(access_start).trim())) {
    await q('UPDATE decks SET access_start = $1 WHERE id = $2', [String(access_start).trim(), deck.id]);
  }
  if (access_end !== undefined && DATE_RE.test(String(access_end).trim())) {
    await q('UPDATE decks SET access_end = $1 WHERE id = $2', [String(access_end).trim(), deck.id]);
  }
  await q('UPDATE decks SET updated_at = now() WHERE id = $1', [deck.id]);
  await log(ctx.user, 'deck_updated', `id=${deck.id}`, req);
  json(res, 200, { ok: true });
});

// 자산 정리 후 실제 삭제 (공통)
async function purgeDeck(deck) {
  if (storage.storageEnabled) {
    const media = await q("SELECT storage_path FROM assets WHERE deck_id = $1 AND storage_path IS NOT NULL", [deck.id]);
    for (const m of media) await storage.removeObject(m.storage_path);
  }
  await q('DELETE FROM decks WHERE id = $1', [deck.id]);
}

// 삭제: 본인이 만든 자료만 가능(#1). 슈퍼관리자는 즉시 삭제, 그 외 소유자는 '삭제 요청'(#4) → 슈퍼관리자 승인
route('DELETE', /^\/api\/decks\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (ctx.user.role === 'superadmin') {
    await purgeDeck(deck);
    await log(ctx.user, 'deck_deleted', `id=${deck.id} title=${deck.title}`, req);
    return json(res, 200, { ok: true, deleted: true });
  }
  // 본인이 올린 자료만 삭제 요청 가능
  if (deck.created_by !== ctx.user.id) return forbidden(res, '본인이 올린 자료만 삭제할 수 있습니다.');
  if (deck.delete_pending) return json(res, 200, { ok: true, pending: true });
  await q(
    'UPDATE decks SET delete_pending = true, delete_requested_by = $1, delete_reason = $2, delete_requested_at = now() WHERE id = $3',
    [ctx.user.id, String(ctx.body?.reason || '').slice(0, 300), deck.id]
  );
  await log(ctx.user, 'deck_delete_requested', `id=${deck.id} title=${deck.title}`, req);
  json(res, 200, { ok: true, pending: true });
});

// 삭제 요청 목록 (슈퍼관리자)
route('GET', /^\/api\/deletion-requests$/, 'superadmin', async (req, res) => {
  const rows = await q(
    `SELECT d.id, d.title, d.kind, d.delete_reason, ${TS('d.delete_requested_at')} AS requested_at,
       u.name AS requester_name, u.username AS requester_username
     FROM decks d LEFT JOIN users u ON u.id = d.delete_requested_by
     WHERE d.delete_pending = true ORDER BY d.delete_requested_at DESC`
  );
  json(res, 200, { requests: rows });
});

// 삭제 승인 (슈퍼관리자) — 실제 삭제
route('POST', /^\/api\/decks\/(\d+)\/delete-approve$/, 'superadmin', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1 AND delete_pending = true', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  await purgeDeck(deck);
  await log(ctx.user, 'deck_delete_approved', `id=${deck.id} title=${deck.title}`, req);
  json(res, 200, { ok: true });
});

// 삭제 반려 (슈퍼관리자)
route('POST', /^\/api\/decks\/(\d+)\/delete-reject$/, 'superadmin', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  await q('UPDATE decks SET delete_pending = false, delete_requested_by = NULL, delete_reason = \'\', delete_requested_at = NULL WHERE id = $1', [deck.id]);
  await log(ctx.user, 'deck_delete_rejected', `id=${deck.id} title=${deck.title}`, req);
  json(res, 200, { ok: true });
});

// ================= 과정(패키지) =================
// 과정 하나를 자료·강사 정보와 함께 조립
async function courseDetail(courseId) {
  const course = await one('SELECT * FROM courses WHERE id = $1', [courseId]);
  if (!course) return null;
  const items = await q(
    `SELECT ci.deck_id, ci.required, ci.position, d.title, d.kind, d.subject, d.cost_type, d.api_provider, d.unit_cost
     FROM course_items ci JOIN decks d ON d.id = ci.deck_id
     WHERE ci.course_id = $1 ORDER BY ci.required DESC, ci.position, ci.deck_id`,
    [courseId]
  );
  const instructors = await q(
    `SELECT cin.instructor_id AS id, u.name, u.username FROM course_instructors cin
     JOIN users u ON u.id = cin.instructor_id WHERE cin.course_id = $1 ORDER BY u.name`,
    [courseId]
  );
  return {
    id: course.id, name: course.name, description: course.description,
    items: items.map((i) => ({
      deckId: i.deck_id, required: !!i.required, position: i.position, title: i.title,
      kind: i.kind, subject: i.subject, costType: i.cost_type, apiProvider: i.api_provider, unitCost: Number(i.unit_cost || 0),
    })),
    instructors,
  };
}

// 과정 목록 (관리자 이상)
route('GET', /^\/api\/courses$/, 'admin', async (req, res) => {
  const rows = await q('SELECT id FROM courses ORDER BY created_at DESC, id DESC');
  const courses = [];
  for (const r of rows) courses.push(await courseDetail(r.id));
  json(res, 200, { courses });
});

// 과정 생성 (관리자 이상)
route('POST', /^\/api\/courses$/, 'admin', async (req, res, ctx) => {
  const { name, description } = ctx.body || {};
  if (!name || !String(name).trim()) return badRequest(res, '과정 이름을 입력하세요.');
  const r = await one('INSERT INTO courses (name, description, created_by) VALUES ($1, $2, $3) RETURNING id',
    [String(name).trim().slice(0, 100), String(description || '').trim().slice(0, 300), ctx.user.id]);
  await log(ctx.user, 'course_created', `id=${r.id} name=${name}`, req);
  json(res, 200, { ok: true, id: r.id });
});

// 과정 정보 수정 (관리자 이상)
route('PATCH', /^\/api\/courses\/(\d+)$/, 'admin', async (req, res, ctx) => {
  const course = await one('SELECT * FROM courses WHERE id = $1', [Number(ctx.params[0])]);
  if (!course) return notFound(res);
  const { name, description } = ctx.body || {};
  if (name !== undefined && String(name).trim()) await q('UPDATE courses SET name = $1 WHERE id = $2', [String(name).trim().slice(0, 100), course.id]);
  if (description !== undefined) await q('UPDATE courses SET description = $1 WHERE id = $2', [String(description).trim().slice(0, 300), course.id]);
  json(res, 200, { ok: true });
});

// 과정 삭제 (관리자 이상) — 링크만 사라짐, 자료 자체는 유지
route('DELETE', /^\/api\/courses\/(\d+)$/, 'admin', async (req, res, ctx) => {
  const course = await one('SELECT * FROM courses WHERE id = $1', [Number(ctx.params[0])]);
  if (!course) return notFound(res);
  await q('DELETE FROM courses WHERE id = $1', [course.id]);
  await log(ctx.user, 'course_deleted', `id=${course.id} name=${course.name}`, req);
  json(res, 200, { ok: true });
});

// 과정에 자료 추가/갱신 (필수·선택 지정) (관리자 이상)
route('POST', /^\/api\/courses\/(\d+)\/items$/, 'admin', async (req, res, ctx) => {
  const course = await one('SELECT * FROM courses WHERE id = $1', [Number(ctx.params[0])]);
  if (!course) return notFound(res);
  const { deck_id, required } = ctx.body || {};
  const deck = await one('SELECT id FROM decks WHERE id = $1', [Number(deck_id)]);
  if (!deck) return badRequest(res, '자료를 찾을 수 없습니다.');
  const req0 = required === undefined ? true : !!required;
  await q(
    `INSERT INTO course_items (course_id, deck_id, required, position)
     VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), -1) + 1 FROM course_items WHERE course_id = $1))
     ON CONFLICT (course_id, deck_id) DO UPDATE SET required = EXCLUDED.required`,
    [course.id, deck.id, req0]
  );
  json(res, 200, { ok: true });
});

// 과정에서 자료 제거 (관리자 이상)
route('DELETE', /^\/api\/courses\/(\d+)\/items\/(\d+)$/, 'admin', async (req, res, ctx) => {
  const courseId = Number(ctx.params[0]);
  const deckId = Number(ctx.params[1]);
  await q('DELETE FROM course_items WHERE course_id = $1 AND deck_id = $2', [courseId, deckId]);
  // 선택 담기 기록도 함께 정리
  await q('DELETE FROM course_opt_ins WHERE course_id = $1 AND deck_id = $2', [courseId, deckId]);
  json(res, 200, { ok: true });
});

// 과정에 강사배정 / 해제 (관리자 이상)
route('POST', /^\/api\/courses\/(\d+)\/instructors$/, 'admin', async (req, res, ctx) => {
  const course = await one('SELECT * FROM courses WHERE id = $1', [Number(ctx.params[0])]);
  if (!course) return notFound(res);
  const target = await one("SELECT id, role FROM users WHERE id = $1", [Number(ctx.body?.instructor_id)]);
  if (!target || !['instructor', 'admin'].includes(target.role)) return badRequest(res, '강사(또는 관리자)만 배정할 수 있습니다.');
  await q('INSERT INTO course_instructors (course_id, instructor_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [course.id, target.id, ctx.user.id]);
  await log(ctx.user, 'course_assigned', `course=${course.id} instructor=${target.id}`, req);
  json(res, 200, { ok: true });
});
route('DELETE', /^\/api\/courses\/(\d+)\/instructors\/(\d+)$/, 'admin', async (req, res, ctx) => {
  await q('DELETE FROM course_instructors WHERE course_id = $1 AND instructor_id = $2', [Number(ctx.params[0]), Number(ctx.params[1])]);
  // 그 강사가 이 과정에서 담았던 선택 자료도 정리
  await q('DELETE FROM course_opt_ins WHERE course_id = $1 AND instructor_id = $2', [Number(ctx.params[0]), Number(ctx.params[1])]);
  json(res, 200, { ok: true });
});

// 강사: 내게 배정된 과정 목록 (필수/선택 자료 + 내 담기 상태)
route('GET', /^\/api\/my-courses$/, 'instructor', async (req, res, ctx) => {
  const rows = await q(
    `SELECT c.id FROM courses c JOIN course_instructors cin ON cin.course_id = c.id
     WHERE cin.instructor_id = $1 ORDER BY c.created_at DESC`,
    [ctx.user.id]
  );
  const optRows = await q('SELECT course_id, deck_id FROM course_opt_ins WHERE instructor_id = $1', [ctx.user.id]);
  const optedSet = new Set(optRows.map((o) => `${o.course_id}:${o.deck_id}`));
  const courses = [];
  for (const r of rows) {
    const c = await courseDetail(r.id);
    if (!c) continue;
    courses.push({
      id: c.id, name: c.name, description: c.description,
      required: c.items.filter((i) => i.required),
      optional: c.items.filter((i) => !i.required).map((i) => ({ ...i, opted: optedSet.has(`${c.id}:${i.deckId}`) })),
    });
  }
  json(res, 200, { courses });
});

// 강사: 선택 자료 담기 / 빼기
route('POST', /^\/api\/courses\/(\d+)\/opt-in$/, 'instructor', async (req, res, ctx) => {
  const courseId = Number(ctx.params[0]);
  const assigned = await one('SELECT 1 AS x FROM course_instructors WHERE course_id = $1 AND instructor_id = $2', [courseId, ctx.user.id]);
  if (!assigned) return forbidden(res, '배정되지 않은 과정입니다.');
  const item = await one('SELECT 1 AS x FROM course_items WHERE course_id = $1 AND deck_id = $2 AND required = false', [courseId, Number(ctx.body?.deck_id)]);
  if (!item) return badRequest(res, '선택 가능한 자료가 아닙니다.');
  await q('INSERT INTO course_opt_ins (course_id, instructor_id, deck_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [courseId, ctx.user.id, Number(ctx.body.deck_id)]);
  await log(ctx.user, 'course_opt_in', `course=${courseId} deck=${ctx.body.deck_id}`, req);
  json(res, 200, { ok: true });
});
route('DELETE', /^\/api\/courses\/(\d+)\/opt-in\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  await q('DELETE FROM course_opt_ins WHERE course_id = $1 AND instructor_id = $2 AND deck_id = $3',
    [Number(ctx.params[0]), ctx.user.id, Number(ctx.params[1])]);
  json(res, 200, { ok: true });
});

// ================= 종량 과금 리포트 (관리자 이상) =================
// GET /api/billing?month=YYYY-MM&group=deck|instructor|session
//   예상 비용 = Σ(호출수 × 자료 단가). 열람(open)은 1호출로 간주, api_call은 실제 보고 호출수.
route('GET', /^\/api\/billing$/, 'admin', async (req, res) => {
  const url = new URL(req.url, 'http://internal');
  const qmonth = url.searchParams.get('month') || '';
  const month = /^\d{4}-\d{2}$/.test(qmonth) ? qmonth : null;
  const group = ['deck', 'instructor', 'session'].includes(url.searchParams.get('group')) ? url.searchParams.get('group') : 'deck';
  // usage_events 기간 필터 (JOIN 조건절에 삽입 — LEFT JOIN 시 자료가 0건이어도 남게)
  const p = month ? [`${month}-01`] : [];
  const period = month ? `AND ue.created_at >= $1::timestamptz AND ue.created_at < ($1::timestamptz + interval '1 month')` : '';
  // 공통 집계 컬럼
  const AGG = `
    COALESCE(SUM(ue.calls), 0)::int AS calls,
    COALESCE(SUM(CASE WHEN ue.kind = 'api_call' THEN ue.calls ELSE 0 END), 0)::int AS api_calls,
    COUNT(DISTINCT ue.user_id)::int AS learners,
    COALESCE(SUM(ue.calls * d.unit_cost), 0)::bigint AS est_cost`;

  let rows;
  if (group === 'instructor') {
    // 강사별: usage가 있는 강사만 (귀속 강사 기준)
    rows = await q(
      `SELECT ue.instructor_id AS id, u.name, u.username, ${AGG},
         COUNT(DISTINCT ue.deck_id)::int AS decks
       FROM usage_events ue JOIN decks d ON d.id = ue.deck_id
       LEFT JOIN users u ON u.id = ue.instructor_id
       WHERE d.cost_type = 'api_paid' ${period}
       GROUP BY ue.instructor_id, u.name, u.username
       ORDER BY est_cost DESC, calls DESC`, p);
  } else if (group === 'session') {
    // 수업(차시)별: 게스트 수업 사용만 (session_id 있는 것)
    rows = await q(
      `SELECT ue.session_id AS id, cs.title, ${TS('cs.created_at')} AS session_at,
         ins.name AS instructor_name, ${AGG},
         COUNT(DISTINCT ue.deck_id)::int AS decks
       FROM usage_events ue JOIN decks d ON d.id = ue.deck_id
       LEFT JOIN class_sessions cs ON cs.id = ue.session_id
       LEFT JOIN users ins ON ins.id = ue.instructor_id
       WHERE d.cost_type = 'api_paid' AND ue.session_id IS NOT NULL ${period}
       GROUP BY ue.session_id, cs.title, cs.created_at, ins.name
       ORDER BY est_cost DESC, calls DESC`, p);
  } else {
    // 자료별 (기본) — usage가 0건인 유료 자료도 목록에 표시(LEFT JOIN)
    rows = await q(
      `SELECT d.id, d.title, d.api_provider, d.unit_cost, ${AGG}
       FROM decks d LEFT JOIN usage_events ue ON ue.deck_id = d.id ${period}
       WHERE d.cost_type = 'api_paid'
       GROUP BY d.id, d.title, d.api_provider, d.unit_cost
       ORDER BY est_cost DESC, d.title`, p);
  }

  const items = rows.map((r) => ({
    id: r.id,
    title: group === 'instructor' ? (r.name || '(미지정)') : group === 'session' ? (r.title || '(삭제된 수업)') : r.title,
    subtitle: group === 'instructor' ? (r.username || '') : group === 'session' ? (r.instructor_name ? `담당 ${r.instructor_name}` : '') : (r.api_provider || ''),
    unitCost: group === 'deck' ? Number(r.unit_cost || 0) : null,
    calls: r.calls, apiCalls: r.api_calls, learners: r.learners,
    decks: r.decks !== undefined ? r.decks : undefined,
    estCost: Number(r.est_cost),
  }));
  const total = items.reduce((s, i) => s + i.estCost, 0);
  json(res, 200, { month, group, items, total });
});

// ================= 정산 (관리자 이상) =================
// 실제 프로바이더 청구액을 입력하면, 측정된 호출 비율로 강사·수업·자료에 배분.
// (고정 예상단가의 오차를 우회 — 총액은 청구서와 정확히 일치, 배분만 호출 비율로)
const SETTLE_GROUP_SQL = {
  instructor: {
    select: `d.api_provider AS provider, ue.instructor_id AS eid,
      COALESCE(u.name, '(미지정)') AS ename, COALESCE(u.username, '') AS esub`,
    join: 'LEFT JOIN users u ON u.id = ue.instructor_id',
    groupBy: 'd.api_provider, ue.instructor_id, u.name, u.username',
  },
  session: {
    select: `d.api_provider AS provider, ue.session_id AS eid,
      COALESCE(cs.title, '(수업 외 사용)') AS ename, COALESCE(ins.name, '') AS esub`,
    join: 'LEFT JOIN class_sessions cs ON cs.id = ue.session_id LEFT JOIN users ins ON ins.id = ue.instructor_id',
    groupBy: 'd.api_provider, ue.session_id, cs.title, ins.name',
  },
  deck: {
    select: `d.api_provider AS provider, d.id AS eid, d.title AS ename, '' AS esub`,
    join: '',
    groupBy: 'd.api_provider, d.id, d.title',
  },
};

// GET /api/settlements?month=YYYY-MM&group=instructor|session|deck
route('GET', /^\/api\/settlements$/, 'admin', async (req, res) => {
  const url = new URL(req.url, 'http://internal');
  const qmonth = url.searchParams.get('month') || '';
  const month = /^\d{4}-\d{2}$/.test(qmonth) ? qmonth : null;
  if (!month) return badRequest(res, '정산 월(YYYY-MM)을 지정하세요.');
  const group = SETTLE_GROUP_SQL[url.searchParams.get('group')] ? url.searchParams.get('group') : 'instructor';
  const g = SETTLE_GROUP_SQL[group];
  const period = `AND ue.created_at >= $1::timestamptz AND ue.created_at < ($1::timestamptz + interval '1 month')`;

  // 입력된 청구액 (프로바이더별)
  const invRows = await q('SELECT * FROM settlements WHERE period = $1', [month]);
  const invMap = new Map(invRows.map((r) => [r.provider || '', r]));

  // 프로바이더 × 대상별 호출 집계
  const rows = await q(
    `SELECT ${g.select},
       COALESCE(SUM(ue.calls), 0)::int AS calls,
       COALESCE(SUM(CASE WHEN ue.kind = 'api_call' THEN ue.calls ELSE 0 END), 0)::int AS api_calls
     FROM usage_events ue JOIN decks d ON d.id = ue.deck_id ${g.join}
     WHERE d.cost_type = 'api_paid' ${period}
     GROUP BY ${g.groupBy}`,
    [`${month}-01`]
  );

  // 프로바이더별로 묶기
  const byProv = new Map();
  for (const r of rows) {
    const key = r.provider || '';
    if (!byProv.has(key)) byProv.set(key, []);
    byProv.get(key).push(r);
  }
  // 청구액만 입력되고 사용이 없는 프로바이더도 포함
  for (const key of invMap.keys()) if (!byProv.has(key)) byProv.set(key, []);

  const providers = [];
  for (const [prov, list] of byProv) {
    const totalCalls = list.reduce((s, r) => s + r.calls, 0);
    const inv = invMap.get(prov) || null;
    const invoiceAmount = inv ? Number(inv.invoice_amount) : null;
    let rowsOut = list
      .map((r) => ({
        id: r.eid, title: r.ename, subtitle: r.esub,
        calls: r.calls, apiCalls: r.api_calls,
        ratio: totalCalls > 0 ? r.calls / totalCalls : 0,
        amount: invoiceAmount != null && totalCalls > 0 ? Math.round(invoiceAmount * r.calls / totalCalls) : null,
      }))
      .sort((a, b) => b.calls - a.calls);
    // 반올림 잔여를 최다 호출 행에 몰아 합계를 청구액과 정확히 일치시킴
    if (invoiceAmount != null && rowsOut.length && totalCalls > 0) {
      const allocated = rowsOut.reduce((s, r) => s + (r.amount || 0), 0);
      rowsOut[0].amount += invoiceAmount - allocated;
    }
    providers.push({
      provider: prov, providerLabel: prov || '(미지정)',
      invoiceId: inv ? inv.id : null, invoiceAmount, note: inv ? inv.note : '', confirmed: inv ? !!inv.confirmed : false,
      totalCalls, allocated: invoiceAmount != null && totalCalls > 0 ? invoiceAmount : 0,
      rows: rowsOut,
    });
  }
  providers.sort((a, b) => (b.invoiceAmount || 0) - (a.invoiceAmount || 0) || b.totalCalls - a.totalCalls);
  const grandInvoice = providers.reduce((s, p) => s + (p.invoiceAmount || 0), 0);
  json(res, 200, { month, group, providers, grandInvoice });
});

// 청구액 입력/수정 (upsert)
route('POST', /^\/api\/settlements$/, 'admin', async (req, res, ctx) => {
  const { period, provider, invoice_amount, note, confirmed } = ctx.body || {};
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) return badRequest(res, '정산 월(YYYY-MM)이 올바르지 않습니다.');
  const amount = Math.max(0, Math.min(1e12, Math.round(Number(invoice_amount) || 0)));
  const prov = String(provider || '').trim().slice(0, 50);
  const r = await one(
    `INSERT INTO settlements (period, provider, invoice_amount, note, confirmed, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (period, provider) DO UPDATE
       SET invoice_amount = EXCLUDED.invoice_amount, note = EXCLUDED.note,
           confirmed = EXCLUDED.confirmed, updated_at = now()
     RETURNING id`,
    [period, prov, amount, String(note || '').slice(0, 300), !!confirmed, ctx.user.id]
  );
  await log(ctx.user, 'settlement_saved', `period=${period} provider=${prov || '(미지정)'} amount=${amount}`, req);
  json(res, 200, { ok: true, id: r.id });
});

// 청구액 삭제
route('DELETE', /^\/api\/settlements\/(\d+)$/, 'admin', async (req, res, ctx) => {
  await q('DELETE FROM settlements WHERE id = $1', [Number(ctx.params[0])]);
  json(res, 200, { ok: true });
});

// ---- 슬라이드 ----
const SLIDE_BGS = new Set(['theme-navy', 'theme-white', 'theme-mint', 'theme-sunset', 'theme-violet', 'theme-dark']);
const SLIDE_ALIGNS = new Set(['left', 'center']);

route('POST', /^\/api\/decks\/(\d+)\/slides$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const r = await one(
    `INSERT INTO slides (deck_id, position)
     VALUES ($1, (SELECT COALESCE(MAX(position), -1) + 1 FROM slides WHERE deck_id = $1)) RETURNING id`,
    [deck.id]
  );
  json(res, 200, { ok: true, id: r.id });
});

async function getSlideDeck(slideId) {
  const slide = await one('SELECT * FROM slides WHERE id = $1', [slideId]);
  if (!slide) return {};
  const deck = await one('SELECT * FROM decks WHERE id = $1', [slide.deck_id]);
  return { slide, deck };
}

route('PATCH', /^\/api\/slides\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const { slide, deck } = await getSlideDeck(Number(ctx.params[0]));
  if (!slide) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { title, body, bg, align } = ctx.body || {};
  if (title !== undefined) await q('UPDATE slides SET title = $1 WHERE id = $2', [String(title).slice(0, 200), slide.id]);
  if (body !== undefined) await q('UPDATE slides SET body = $1 WHERE id = $2', [String(body).slice(0, 20000), slide.id]);
  if (bg !== undefined) {
    // 기본 테마 또는 업로드한 배경(bg:<자산ID>:<글자색>)
    let valid = SLIDE_BGS.has(bg);
    const bgm = /^bg:(\d+):(light|dark)$/.exec(String(bg));
    if (!valid && bgm) {
      valid = !!(await one('SELECT id FROM assets WHERE id = $1 AND is_bg = true', [Number(bgm[1])]));
    }
    if (valid) await q('UPDATE slides SET bg = $1 WHERE id = $2', [bg, slide.id]);
  }
  if (align !== undefined && SLIDE_ALIGNS.has(align)) await q('UPDATE slides SET align = $1 WHERE id = $2', [align, slide.id]);
  await q('UPDATE decks SET updated_at = now() WHERE id = $1', [deck.id]);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/slides\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const { slide, deck } = await getSlideDeck(Number(ctx.params[0]));
  if (!slide) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  await q('DELETE FROM slides WHERE id = $1', [slide.id]);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/decks\/(\d+)\/reorder$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { ids } = ctx.body || {};
  if (!Array.isArray(ids)) return badRequest(res, 'ids 배열이 필요합니다.');
  for (let i = 0; i < ids.length; i++) {
    await q('UPDATE slides SET position = $1 WHERE id = $2 AND deck_id = $3', [i, Number(ids[i]), deck.id]);
  }
  json(res, 200, { ok: true });
});

// ================= PPT 변환 (슬라이드 이미지 업로드) =================
// PowerPoint에서 "내보내기 → PNG/JPEG"로 만든 슬라이드 이미지를 한 장씩 받아
// 이미지 전용 슬라이드로 추가한다. (이미지는 DB에 base64로 저장)
route('POST', /^\/api\/decks\/(\d+)\/import-image$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body?.data || ''));
  if (!m) return badRequest(res, '이미지 데이터가 올바르지 않습니다.');
  if (m[2].length > 2_800_000) return badRequest(res, '이미지가 너무 큽니다. (변환 후 2MB 이하)');
  const a = await one('INSERT INTO assets (deck_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [deck.id, m[1], m[2]]);
  await q(
    `INSERT INTO slides (deck_id, position, title, body, bg)
     VALUES ($1, (SELECT COALESCE(MAX(position), -1) + 1 FROM slides WHERE deck_id = $1), '', $2, 'theme-dark')`,
    [deck.id, `![](/api/assets/${a.id})`]
  );
  await q('UPDATE decks SET updated_at = now() WHERE id = $1', [deck.id]);
  json(res, 200, { ok: true, assetId: a.id });
});

// ---- 슬라이드용 미디어(동영상/이미지) 자산 업로드 → 본문에 삽입 ----
// 반환한 id로 클라이언트가 !video(/api/assets/id) 또는 이미지 태그를 본문에 넣는다.
const MEDIA_DATA_RE = /^data:(image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|ogg)|audio\/(?:mpeg|ogg));base64,([A-Za-z0-9+/=]+)$/;
route('POST', /^\/api\/decks\/(\d+)\/asset$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const m = MEDIA_DATA_RE.exec(String(ctx.body?.data || ''));
  if (!m) return badRequest(res, '지원하지 않는 파일 형식입니다. (동영상 mp4/webm, 이미지)');
  if (m[2].length > 34_000_000) return badRequest(res, '파일이 너무 큽니다. (약 25MB 이하)');
  const a = await one('INSERT INTO assets (deck_id, mime, data, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
    [deck.id, m[1], m[2], ctx.user.id]);
  json(res, 200, { ok: true, id: a.id, mime: m[1] });
});

// ---- 대용량 동영상: Supabase Storage 직접 업로드 (서버·Vercel 우회) ----
const STORAGE_MIME = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const EXT_BY_MIME = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv' };

// 1) 서명 업로드 URL 발급 — 브라우저가 이 URL로 파일을 직접 PUT
route('POST', /^\/api\/decks\/(\d+)\/media-sign$/, 'instructor', async (req, res, ctx) => {
  if (!storage.storageEnabled) return badRequest(res, '대용량 업로드가 설정되지 않았습니다. (SUPABASE_URL/SERVICE_KEY)');
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const mime = String(ctx.body?.mime || '');
  if (!STORAGE_MIME.has(mime)) return badRequest(res, '동영상 파일(mp4/webm)만 대용량 업로드가 가능합니다.');
  const size = Number(ctx.body?.size || 0);
  if (size > 209_715_200) return badRequest(res, '동영상은 200MB 이하여야 합니다.');
  const rand = crypto.randomBytes(8).toString('hex');
  const path = `deck${deck.id}/${Date.now()}-${rand}.${EXT_BY_MIME[mime]}`;
  try {
    const { uploadUrl } = await storage.createSignedUpload(path);
    json(res, 200, { uploadUrl, path, mime });
  } catch (e) {
    json(res, 502, { error: String(e.message).slice(0, 200) });
  }
});

// 2) 업로드 완료 확인 → 자산 등록 (data 없이 storage_path만)
route('POST', /^\/api\/decks\/(\d+)\/media-confirm$/, 'instructor', async (req, res, ctx) => {
  if (!storage.storageEnabled) return badRequest(res, '대용량 업로드가 설정되지 않았습니다.');
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const path = String(ctx.body?.path || '');
  const mime = String(ctx.body?.mime || '');
  if (!path.startsWith(`deck${deck.id}/`) || !STORAGE_MIME.has(mime)) return badRequest(res, '잘못된 요청입니다.');
  const a = await one(
    "INSERT INTO assets (deck_id, mime, data, storage_path, created_by) VALUES ($1, $2, '', $3, $4) RETURNING id",
    [deck.id, mime, path, ctx.user.id]
  );
  json(res, 200, { ok: true, id: a.id, mime });
});

// ---- 업로드형 HTML 웹앱 서빙 ----
// 배포 없이 올린 단일 HTML 파일을 로그인·배정·시간 규칙 하에서 실행한다.
route('GET', /^\/api\/webapp\/(\d+)$/, 'student', async (req, res, ctx) => {
  const deck = await one(`${DECK_SELECT} WHERE d.id = $1`, [Number(ctx.params[0])]);
  if (!deck || deck.kind !== 'html') return notFound(res);
  if (ctx.guestSession) {
    const acc = await guestDeckAccess(ctx.guestSession, deck.id);
    if (!acc.listed) return forbidden(res, '이 수업에서 이용할 수 없는 웹앱입니다.');
    if (acc.locked) return forbidden(res, '아직 잠겨 있는 웹앱입니다. 선생님이 열어주면 이용할 수 있어요.');
    await log(ctx.user, 'deck_viewed', `id=${deck.id} title=${deck.title}`, req);
  } else if (ctx.user.role === 'student') {
    if (!deckVisibleToStudent(deck, ctx.user, todayInTimezone())) return forbidden(res, '이용 권한이 없는 웹앱입니다.');
    const access = await checkAccess(deck.id);
    if (!access.allowed) return forbidden(res, '지금은 이용이 허용된 시간이 아닙니다.');
    await log(ctx.user, 'deck_viewed', `id=${deck.id} title=${deck.title}`, req);
  }
  const a = await one("SELECT * FROM assets WHERE deck_id = $1 AND mime = 'text/html' ORDER BY id DESC LIMIT 1", [deck.id]);
  if (!a) return notFound(res);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(Buffer.from(a.data, 'base64'));
});

// ---- 슬라이드 배경 라이브러리 (배경 이미지 업로드 → 테마처럼 선택) ----
const IMAGE_DATA_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

route('GET', /^\/api\/backgrounds$/, 'instructor', async (req, res) => {
  const rows = await q('SELECT id, name, created_by FROM assets WHERE is_bg = true ORDER BY id DESC LIMIT 100');
  json(res, 200, { backgrounds: rows });
});

route('POST', /^\/api\/backgrounds$/, 'instructor', async (req, res, ctx) => {
  const m = IMAGE_DATA_RE.exec(String(ctx.body?.data || ''));
  if (!m) return badRequest(res, '이미지 데이터가 올바르지 않습니다.');
  if (m[2].length > 2_800_000) return badRequest(res, '이미지가 너무 큽니다. (변환 후 2MB 이하)');
  const name = String(ctx.body?.name || '').trim().slice(0, 50) || '내 배경';
  const a = await one(
    'INSERT INTO assets (mime, data, name, created_by, is_bg) VALUES ($1, $2, $3, $4, true) RETURNING id',
    [m[1], m[2], name, ctx.user.id]
  );
  await log(ctx.user, 'deck_updated', `배경 업로드: ${name}`, req);
  json(res, 200, { ok: true, id: a.id, name });
});

route('DELETE', /^\/api\/backgrounds\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const a = await one('SELECT * FROM assets WHERE id = $1 AND is_bg = true', [Number(ctx.params[0])]);
  if (!a) return notFound(res);
  if (a.created_by !== ctx.user.id && roleLevel(ctx.user.role) < roleLevel('admin')) return forbidden(res);
  await q('DELETE FROM assets WHERE id = $1', [a.id]);
  json(res, 200, { ok: true });
});

// 미디어 자산 서빙 (로그인 필요). 동영상 탐색(seek)을 위해 HTTP Range 요청 지원.
route('GET', /^\/api\/assets\/(\d+)$/, 'student', async (req, res, ctx) => {
  const a = await one('SELECT * FROM assets WHERE id = $1', [Number(ctx.params[0])]);
  if (!a) return notFound(res);
  // Supabase Storage 자산: 접근 권한은 통과했으므로 단기 서명 URL로 리다이렉트
  if (a.storage_path && storage.storageEnabled) {
    try {
      const url = await storage.createSignedDownload(a.storage_path);
      res.writeHead(302, { Location: url, 'Cache-Control': 'private, no-store' });
      return res.end();
    } catch (e) {
      return json(res, 502, { error: '동영상을 불러올 수 없습니다.' });
    }
  }
  const buf = Buffer.from(a.data, 'base64');
  const range = req.headers.range;
  const rm = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (rm) {
    const start = rm[1] ? parseInt(rm[1], 10) : 0;
    const end = rm[2] ? parseInt(rm[2], 10) : buf.length - 1;
    if (start >= buf.length || end >= buf.length || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` });
      return res.end();
    }
    const chunk = buf.subarray(start, end + 1);
    res.writeHead(206, {
      'Content-Type': a.mime,
      'Content-Range': `bytes ${start}-${end}/${buf.length}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk.length,
      'Cache-Control': 'private, max-age=86400',
    });
    return res.end(chunk);
  }
  res.writeHead(200, {
    'Content-Type': a.mime,
    'Content-Length': buf.length,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  });
  res.end(buf);
});

// ================= 외부 웹앱 게이트 =================
// 15분 유효 서명 토큰: 외부 웹앱이 이 토큰 없이는 스스로 접속을 거부하게 만든다.
const GATE_TTL_MS = 15 * 60 * 1000;

async function gateSecret() {
  return (await one("SELECT value FROM settings WHERE key = 'gate_secret'")).value;
}
function signGate(secret, deckId, userId, exp) {
  return crypto.createHmac('sha256', secret).update(`${deckId}.${userId}.${exp}`).digest('hex').slice(0, 32);
}

// 게이트 토큰 발급 — 덱 열람과 동일한 접근 규칙 적용
route('GET', /^\/api\/gate-token\/(\d+)$/, 'student', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck || deck.kind !== 'link' || !deck.external_url) return notFound(res);
  if (ctx.guestSession) {
    const acc = await guestDeckAccess(ctx.guestSession, deck.id);
    if (!acc.listed) return forbidden(res, '이 수업에서 이용할 수 없는 웹앱입니다.');
    if (acc.locked) return forbidden(res, '아직 잠겨 있는 웹앱입니다. 선생님이 열어주면 이용할 수 있어요.');
  } else if (ctx.user.role === 'student') {
    if (!deckVisibleToStudent(deck, ctx.user, todayInTimezone())) return forbidden(res, '이용 권한이 없는 웹앱입니다.');
    const access = await checkAccess(deck.id);
    if (!access.allowed) {
      return json(res, 403, { error: 'time_blocked', message: '이 웹앱은 지금 이용이 허용된 시간이 아닙니다.', access });
    }
  }
  const exp = Date.now() + GATE_TTL_MS;
  const sig = signGate(await gateSecret(), deck.id, ctx.user.id, exp);
  const token = `${deck.id}.${ctx.user.id}.${exp}.${sig}`;
  const url = `${deck.external_url}${deck.external_url.includes('?') ? '&' : '?'}gate=${encodeURIComponent(token)}`;
  json(res, 200, { token, url, expiresInMinutes: GATE_TTL_MS / 60000 });
});

// 외부 웹앱이 호출하는 공개 검증 엔드포인트 (CORS 허용)
route('GET', /^\/api\/gate\/verify$/, null, async (req, res) => {
  const url = new URL(req.url, 'http://internal');
  const token = String(url.searchParams.get('token') || '');
  const reply = (body) => {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };
  const m = /^(\d+)\.(\d+)\.(\d+)\.([a-f0-9]{32})$/.exec(token);
  if (!m) return reply({ valid: false });
  const [, deckId, userId, exp, sig] = m;
  if (Number(exp) < Date.now()) return reply({ valid: false, reason: 'expired' });
  const expected = signGate(await gateSecret(), Number(deckId), Number(userId), Number(exp));
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return reply({ valid: false });
  const viewer = await one('SELECT name FROM users WHERE id = $1', [Number(userId)]);
  reply({ valid: true, name: viewer ? viewer.name : null });
});

// 게이트 토큰 검증 → { deckId, userId } (만료·서명 확인). 실패 시 null
async function verifyGateToken(token) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.([a-f0-9]{32})$/.exec(String(token || ''));
  if (!m) return null;
  const [, deckId, userId, exp, sig] = m;
  if (Number(exp) < Date.now()) return null;
  const expected = signGate(await gateSecret(), Number(deckId), Number(userId), Number(exp));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { deckId: Number(deckId), userId: Number(userId) };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
route('OPTIONS', /^\/api\/usage\/report$/, null, async (req, res) => {
  res.writeHead(204, CORS_HEADERS); res.end();
});

// 실제 API 호출량 보고 (외부 앱: 게이트 토큰 / 플랫폼 내 앱: 세션 쿠키).
// 앱이 API를 호출할 때마다(또는 묶어서) navigator.sendBeacon 등으로 호출 수를 보고한다.
// 유료 자료만 집계되며, 사용은 수업(session)·강사 단위로 귀속된다.
route('POST', /^\/api\/usage\/report$/, null, async (req, res, ctx) => {
  const cors = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS }); res.end(JSON.stringify(body)); };
  const b = (ctx && ctx.body) || {};
  const calls = Math.max(1, Math.min(10000, Math.round(Number(b.calls) || 1)));
  let deckId = null;
  let viewer = null;
  // 1) 게이트 토큰(외부 앱)
  if (b.token) {
    const v = await verifyGateToken(b.token);
    if (!v) return cors(200, { ok: false, reason: 'invalid_token' });
    deckId = v.deckId;
    viewer = await one('SELECT * FROM users WHERE id = $1', [v.userId]);
  } else {
    // 2) 세션 쿠키(플랫폼 내 학생) + body.deckId
    const session = await getSessionUser(req);
    if (!session) return cors(401, { ok: false, reason: 'auth' });
    viewer = session.user;
    deckId = Number(b.deckId);
  }
  const deck = deckId ? await one('SELECT * FROM decks WHERE id = $1', [deckId]) : null;
  if (!deck) return cors(200, { ok: false, reason: 'no_deck' });
  if (deck.cost_type !== 'api_paid') return cors(200, { ok: true, counted: false }); // 무료 자료는 집계 안 함
  const guestSession = viewer && viewer.guest_session_id
    ? await one('SELECT * FROM class_sessions WHERE id = $1', [viewer.guest_session_id]) : null;
  await recordUsage(deck, viewer, guestSession, { kind: 'api_call', calls });
  cors(200, { ok: true, counted: true, calls });
});

// ================= 보안 설정 =================
const BOOL_SETTING_KEYS = new Set([
  'block_capture', 'block_copy', 'block_rightclick', 'watermark',
  'devtools_detect', 'single_session', 'ip_restrict', 'two_factor',
]);

route('GET', /^\/api\/settings$/, 'student', async (req, res, ctx) => {
  json(res, 200, { settings: clientSettings(await getSettings(), ctx.user) });
});

route('PATCH', /^\/api\/settings$/, 'admin', async (req, res, ctx) => {
  for (const [k, v] of Object.entries(ctx.body || {})) {
    if (BOOL_SETTING_KEYS.has(k)) await setSetting(k, !!v);
    else if (k === 'ip_allowlist') await setSetting(k, String(v ?? '').slice(0, 1000));
    else if (k === 'wm_text') await setSetting(k, String(v ?? '').slice(0, 100));
    else if (k === 'wm_position' && ['tile', 'corner-br', 'corner-tl', 'center'].includes(v)) await setSetting(k, v);
    else if (k === 'wm_opacity' && ['light', 'medium', 'strong'].includes(v)) await setSetting(k, v);
  }
  await log(ctx.user, 'settings_updated', JSON.stringify(ctx.body).slice(0, 200), req);
  json(res, 200, { settings: clientSettings(await getSettings(), ctx.user) });
});

// ================= 대시보드 통계 =================
route('GET', /^\/api\/dashboard$/, 'instructor', async (req, res) => {
  const cnt = async (sql, params = []) => (await one(sql, params)).c;
  const LOG_SELECT = `SELECT *, ${TS('created_at')} AS created_at FROM audit_logs`;
  json(res, 200, {
    stats: {
      decks: await cnt('SELECT count(*)::int AS c FROM decks'),
      publishedDecks: await cnt('SELECT count(*)::int AS c FROM decks WHERE published = true'),
      decksDelta: await cnt("SELECT count(*)::int AS c FROM decks WHERE created_at >= now() - interval '7 days'"),
      instructors: await cnt("SELECT count(*)::int AS c FROM users WHERE role = 'instructor' AND active = true"),
      instructorsDelta: await cnt("SELECT count(*)::int AS c FROM users WHERE role = 'instructor' AND created_at >= now() - interval '7 days'"),
      students: await cnt("SELECT count(*)::int AS c FROM users WHERE role = 'student' AND active = true AND guest_session_id IS NULL"),
      studentsDelta: await cnt("SELECT count(*)::int AS c FROM users WHERE role = 'student' AND created_at >= now() - interval '7 days' AND guest_session_id IS NULL"),
      todayLogins: await cnt(`SELECT count(*)::int AS c FROM audit_logs WHERE action = 'login' AND created_at >= ${KST_TODAY}`),
      yesterdayLogins: await cnt(`SELECT count(*)::int AS c FROM audit_logs WHERE action = 'login' AND created_at >= ${KST_TODAY} - interval '1 day' AND created_at < ${KST_TODAY}`),
      todayBlocked: await cnt(`SELECT count(*)::int AS c FROM audit_logs WHERE action IN ('time_blocked','ip_blocked') AND created_at >= ${KST_TODAY}`),
      captureAttempts: await cnt("SELECT count(*)::int AS c FROM audit_logs WHERE action = 'capture_attempt'"),
      warnings: await cnt("SELECT count(*)::int AS c FROM audit_logs WHERE action IN ('capture_attempt','multi_session','ip_blocked','otp_failed','login_failed') AND created_at >= now() - interval '1 day'"),
    },
    recentLogs: await q(`${LOG_SELECT} ORDER BY id DESC LIMIT 8`),
    alerts: await q(`${LOG_SELECT} WHERE action IN ('capture_attempt','multi_session','ip_blocked','otp_failed','time_blocked','login_failed') ORDER BY id DESC LIMIT 6`),
  });
});

// 강사별·전체 수업 일정 캘린더 (관리자 이상) — 요일×시간대 달력용
route('GET', /^\/api\/class-calendar$/, 'admin', async (req, res) => {
  const tz = process.env.APP_TIMEZONE || 'Asia/Seoul';
  const sessions = await q(
    `SELECT cs.id, cs.title, cs.code, cs.instructor_id, ins.name AS instructor_name,
       extract(dow from cs.created_at AT TIME ZONE '${tz}')::int AS dow,
       to_char(cs.created_at AT TIME ZONE '${tz}', 'HH24:MI') AS start_time,
       to_char(cs.expires_at AT TIME ZONE '${tz}', 'HH24:MI') AS end_time,
       to_char(cs.created_at AT TIME ZONE '${tz}', 'YYYY-MM-DD') AS date,
       cs.active, (cs.expires_at <= now()) AS expired,
       (SELECT count(*)::int FROM users u WHERE u.guest_session_id = cs.id) AS joined
     FROM class_sessions cs LEFT JOIN users ins ON ins.id = cs.instructor_id
     WHERE cs.created_at >= now() - interval '35 days'
     ORDER BY cs.created_at DESC LIMIT 300`
  );
  const teachers = await q(
    "SELECT id, name, username, role FROM users WHERE role IN ('instructor','admin','superadmin') AND active = true ORDER BY role DESC, name"
  );
  json(res, 200, { sessions, teachers });
});

// ================= 리포트 =================
route('GET', /^\/api\/report$/, 'admin', async (req, res) => {
  const daily = await q(`
    SELECT to_char(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE action = 'login')::int AS logins,
      count(*) FILTER (WHERE action IN ('time_blocked','ip_blocked'))::int AS blocked,
      count(*) FILTER (WHERE action = 'capture_attempt')::int AS captures
    FROM audit_logs
    WHERE created_at >= now() - interval '7 days'
    GROUP BY 1 ORDER BY 1
  `);
  const topDecks = await q(`
    SELECT detail, count(*)::int AS views FROM audit_logs
    WHERE action = 'deck_viewed' GROUP BY detail ORDER BY views DESC LIMIT 5
  `);
  const byAction = await q(`
    SELECT action, count(*)::int AS cnt FROM audit_logs
    WHERE action IN ('login','time_blocked','ip_blocked','capture_attempt','login_failed','multi_session')
    GROUP BY action
  `);
  const activeStudents = await q(`
    SELECT username, count(*)::int AS cnt FROM audit_logs
    WHERE action = 'deck_viewed' AND created_at >= now() - interval '7 days' AND username IS NOT NULL
    GROUP BY username ORDER BY cnt DESC LIMIT 5
  `);
  json(res, 200, { daily, topDecks, byAction, activeStudents });
});

// ================= 로그 / 캡처 신고 =================
route('GET', /^\/api\/logs$/, 'admin', async (req, res) => {
  const rows = await q(`SELECT *, ${TS('created_at')} AS created_at FROM audit_logs ORDER BY id DESC LIMIT 300`);
  json(res, 200, { logs: rows });
});

route('POST', /^\/api\/report-capture$/, 'student', async (req, res, ctx) => {
  const { type, detail } = ctx.body || {};
  await log(ctx.user, 'capture_attempt', `type=${String(type).slice(0, 50)} ${String(detail || '').slice(0, 200)}`, req);
  json(res, 200, { ok: true });
});

// ================= 디스패처 =================
async function handleApi(req, res, pathname, body) {
  await ready(); // 스키마·시드 초기화 (인스턴스당 1회)
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;

    // 인증
    let user = null;
    let token = null;
    if (r.minRole !== null) {
      const session = await getSessionUser(req);
      if (!session) return json(res, 401, { error: '로그인이 필요합니다.' });
      user = session.user;
      token = session.token;
      if (roleLevel(user.role) < roleLevel(r.minRole)) return forbidden(res);

      // 게스트(입장 코드) 학생: 시간표 대신 수업 세션의 유효성으로 판정
      var guestSession = null;
      if (user.guest_session_id) {
        guestSession = await one('SELECT * FROM class_sessions WHERE id = $1', [user.guest_session_id]);
        if (!guestSession || !guestSession.active || new Date(guestSession.expires_at) <= new Date()) {
          await destroySession(token);
          return json(res, 401, { error: '수업이 종료되었습니다. 새 입장 코드로 다시 접속하세요.' });
        }
      }

      // 학생 시간제한: 게스트가 아니고, 예외 경로가 아니면 허용 시간 밖에서 403
      if (user.role === 'student' && !guestSession && !STUDENT_EXEMPT.some((re) => re.test(pathname))) {
        const access = await checkAccess();
        if (!access.allowed) {
          await log(user, 'time_blocked', pathname, req);
          return json(res, 403, { error: 'time_blocked', message: '지금은 접근이 허용된 시간이 아닙니다.', access });
        }
      }

      // 계약·보안 동의 게이트: 강사·관리자는 동의 완료 전 예외 경로만 허용
      if (!AGREEMENT_EXEMPT.some((re) => re.test(pathname)) && !user.must_change_password) {
        if (await needsAgreement(user, await getSettings())) {
          return json(res, 403, { error: 'agreement_required', message: '이용을 위해 계약·보안 동의가 필요합니다.' });
        }
      }
    }
    return r.handler(req, res, { user, token, params: m.slice(1), body, guestSession });
  }
  notFound(res);
}

module.exports = { handleApi };
