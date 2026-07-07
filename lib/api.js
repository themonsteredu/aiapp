'use strict';
const { q, one, ready, log, getSettings, setSetting, clientIp, TS, KST_TODAY } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { createSession, destroySession, getSessionUser, cleanupSessions, roleLevel } = require('./auth');
const { checkAccess, toMinutes, todayInTimezone } = require('./schedule');
const { generateSecret, verifyTotp } = require('./totp');

const ROLE_LABELS = { superadmin: '슈퍼관리자', admin: '관리자', instructor: '강사', student: '학생' };

// HTTPS 뒤에서 운영할 때 COOKIE_SECURE=1 (Vercel에서는 자동) 설정 시 세션 쿠키에 Secure 속성이 붙는다.
const COOKIE_SECURE = (process.env.COOKIE_SECURE === '1' || process.env.VERCEL) ? '; Secure' : '';

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
    createdAt: u.created_at,
    createdBy: u.created_by,
  };
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

// 상위 역할만 하위 역할 계정을 만들 수 있다.
function canManage(actor, targetRole) {
  return roleLevel(actor.role) > roleLevel(targetRole);
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
    'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${COOKIE_SECURE}`,
  });
  res.end(JSON.stringify({ user: publicUser(user), access: await checkAccess(), settings }));
});

route('POST', /^\/api\/logout$/, 'student', async (req, res, ctx) => {
  await destroySession(ctx.token);
  await log(ctx.user, 'logout', '');
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE}`,
  });
  res.end(JSON.stringify({ ok: true }));
});

route('GET', /^\/api\/me$/, 'student', async (req, res, ctx) => {
  const settings = await getSettings();
  if (ctx.user.role === 'student') delete settings.ip_allowlist;
  json(res, 200, { user: publicUser(ctx.user), access: await checkAccess(), settings });
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
  const all = await q(`${USER_SELECT} ORDER BY role, username`);
  const visible = ctx.user.role === 'superadmin' ? all : all.filter((u) => canManage(ctx.user, u.role));
  json(res, 200, { users: visible.map(publicUser) });
});

route('POST', /^\/api\/users$/, 'instructor', async (req, res, ctx) => {
  const { username, name, role, password, class_name } = ctx.body || {};
  if (!USERNAME_RE.test(String(username || ''))) {
    return badRequest(res, '아이디는 3~30자의 영문/숫자/._- 만 가능합니다.');
  }
  if (!name || String(name).trim().length === 0) return badRequest(res, '이름을 입력하세요.');
  if (!ROLE_LABELS[role]) return badRequest(res, '올바르지 않은 역할입니다.');
  if (!canManage(ctx.user, role)) return forbidden(res, '자신보다 낮은 권한의 계정만 만들 수 있습니다.');
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
    if (!ROLE_LABELS[role] || !canManage(ctx.user, role)) return forbidden(res, '해당 역할로 변경할 권한이 없습니다.');
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
  };
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

route('GET', /^\/api\/decks$/, 'student', async (req, res, ctx) => {
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
  const rows = await q(`${DECK_SELECT} ORDER BY d.updated_at DESC`);
  json(res, 200, { decks: rows.map(deckWithMeta) });
});

route('POST', /^\/api\/decks$/, 'instructor', async (req, res, ctx) => {
  const { title, description } = ctx.body || {};
  if (!title || !String(title).trim()) return badRequest(res, '제목을 입력하세요.');
  const r = await one(
    'INSERT INTO decks (title, description, created_by) VALUES ($1, $2, $3) RETURNING id',
    [String(title).trim(), String(description || '').trim(), ctx.user.id]
  );
  await q("INSERT INTO slides (deck_id, position, title, body) VALUES ($1, 0, $2, '## 부제목을 입력하세요')", [r.id, String(title).trim()]);
  await log(ctx.user, 'deck_created', `id=${r.id} title=${title}`, req);
  json(res, 200, { ok: true, id: r.id });
});

route('GET', /^\/api\/decks\/(\d+)$/, 'student', async (req, res, ctx) => {
  const deck = await one(`${DECK_SELECT} WHERE d.id = $1`, [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
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
  }
  const slides = await q('SELECT * FROM slides WHERE deck_id = $1 ORDER BY position, id', [deck.id]);
  json(res, 200, { deck: deckWithMeta(deck), slides, canEdit: ctx.user.role !== 'student' && canEditDeck(ctx.user, deck) });
});

route('PATCH', /^\/api\/decks\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { title, description, published, target_classes, access_start, access_end } = ctx.body || {};
  if (title !== undefined && String(title).trim()) {
    await q('UPDATE decks SET title = $1 WHERE id = $2', [String(title).trim(), deck.id]);
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

route('DELETE', /^\/api\/decks\/(\d+)$/, 'instructor', async (req, res, ctx) => {
  const deck = await one('SELECT * FROM decks WHERE id = $1', [Number(ctx.params[0])]);
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  await q('DELETE FROM decks WHERE id = $1', [deck.id]);
  await log(ctx.user, 'deck_deleted', `id=${deck.id} title=${deck.title}`, req);
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
  if (bg !== undefined && SLIDE_BGS.has(bg)) await q('UPDATE slides SET bg = $1 WHERE id = $2', [bg, slide.id]);
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

// ================= 보안 설정 =================
const BOOL_SETTING_KEYS = new Set([
  'block_capture', 'block_copy', 'block_rightclick', 'watermark',
  'devtools_detect', 'single_session', 'ip_restrict', 'two_factor',
]);

route('GET', /^\/api\/settings$/, 'student', async (req, res, ctx) => {
  const settings = await getSettings();
  if (ctx.user.role === 'student') delete settings.ip_allowlist;
  json(res, 200, { settings });
});

route('PATCH', /^\/api\/settings$/, 'admin', async (req, res, ctx) => {
  for (const [k, v] of Object.entries(ctx.body || {})) {
    if (BOOL_SETTING_KEYS.has(k)) await setSetting(k, !!v);
    else if (k === 'ip_allowlist') await setSetting(k, String(v ?? '').slice(0, 1000));
  }
  await log(ctx.user, 'settings_updated', JSON.stringify(ctx.body).slice(0, 200), req);
  json(res, 200, { settings: await getSettings() });
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
      students: await cnt("SELECT count(*)::int AS c FROM users WHERE role = 'student' AND active = true"),
      studentsDelta: await cnt("SELECT count(*)::int AS c FROM users WHERE role = 'student' AND created_at >= now() - interval '7 days'"),
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

      // 학생 시간제한: 예외 경로가 아니면 허용 시간 밖에서 403
      if (user.role === 'student' && !STUDENT_EXEMPT.some((re) => re.test(pathname))) {
        const access = await checkAccess();
        if (!access.allowed) {
          await log(user, 'time_blocked', pathname, req);
          return json(res, 403, { error: 'time_blocked', message: '지금은 접근이 허용된 시간이 아닙니다.', access });
        }
      }
    }
    return r.handler(req, res, { user, token, params: m.slice(1), body });
  }
  notFound(res);
}

module.exports = { handleApi };
