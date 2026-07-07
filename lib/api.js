'use strict';
const { db, log, getSettings, setSetting, clientIp } = require('./db');
const { hashPassword, verifyPassword } = require('./password');
const { createSession, destroySession, getSessionUser, roleLevel } = require('./auth');
const { checkAccess, toMinutes, todayInTimezone } = require('./schedule');
const { generateSecret, verifyTotp } = require('./totp');

const ROLE_LABELS = { superadmin: '슈퍼관리자', admin: '관리자', instructor: '강사', student: '학생' };

// HTTPS 뒤에서 운영할 때 COOKIE_SECURE=1 을 설정하면 세션 쿠키에 Secure 속성이 붙는다.
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';

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
// 각 항목: method, 경로 정규식, 최소 역할(null=로그인 불필요), handler(req, res, ctx)
// ctx = { user, token, params, body }
const routes = [];
function route(method, pattern, minRole, handler) {
  routes.push({ method, pattern, minRole, handler });
}

// 학생 시간제한 예외 경로: 로그인/로그아웃/내정보/시간표 조회/캡처신고는 차단 시간에도 허용
const STUDENT_EXEMPT = [
  /^\/api\/login$/, /^\/api\/logout$/, /^\/api\/me$/, /^\/api\/schedules$/,
  /^\/api\/report-capture$/, /^\/api\/password$/, /^\/api\/settings$/,
];

// ================= 인증 =================
route('POST', /^\/api\/login$/, null, (req, res, ctx) => {
  const { username, password, otp } = ctx.body || {};
  if (!username || !password) return badRequest(res, '아이디와 비밀번호를 입력하세요.');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!user || !verifyPassword(String(password), user.password_hash)) {
    log(user || null, 'login_failed', `username=${String(username).slice(0, 50)}`, req);
    return json(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  if (!user.active) {
    log(user, 'login_blocked', '비활성 계정', req);
    return json(res, 403, { error: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
  }
  const settings = getSettings();

  // IP 제한: 학생 계정만 검사 (관리자 잠금 사고 방지)
  if (settings.ip_restrict && user.role === 'student') {
    const ip = clientIp(req);
    if (!ipAllowed(ip, settings.ip_allowlist)) {
      log(user, 'ip_blocked', `ip=${ip}`, req);
      return json(res, 403, { error: '허용되지 않은 네트워크(IP)에서의 접속입니다.' });
    }
  }

  // 2단계 인증: 관리자 이상 계정에 적용
  if (settings.two_factor && roleLevel(user.role) >= roleLevel('admin')) {
    if (!user.totp_enabled) {
      // 최초 설정: 비밀키를 발급하고 첫 코드 확인 후 활성화
      let secret = user.totp_secret;
      if (!secret) {
        secret = generateSecret();
        db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
      }
      if (!otp) return json(res, 401, { needOtpSetup: true, secret, error: '2단계 인증 최초 등록이 필요합니다.' });
      if (!verifyTotp(secret, otp)) {
        log(user, 'otp_failed', '2단계 인증 등록 코드 불일치', req);
        return json(res, 401, { needOtpSetup: true, secret, error: '인증 코드가 올바르지 않습니다.' });
      }
      db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(user.id);
      log(user, 'otp_enrolled', '2단계 인증 등록 완료', req);
    } else {
      if (!otp) return json(res, 401, { needOtp: true, error: '2단계 인증 코드를 입력하세요.' });
      if (!verifyTotp(user.totp_secret, otp)) {
        log(user, 'otp_failed', '2단계 인증 코드 불일치', req);
        return json(res, 401, { needOtp: true, error: '인증 코드가 올바르지 않습니다.' });
      }
    }
  }

  // 동시접속 제한: 켜져 있으면 학생은 마지막 로그인 기기만 유지
  if (settings.single_session && user.role === 'student') {
    const existing = db.prepare('SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?').get(user.id).c;
    if (existing > 0) log(user, 'multi_session', `기존 세션 ${existing}개 종료`, req);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  }
  const token = createSession(user.id);
  log(user, 'login', '', req);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${COOKIE_SECURE}`,
  });
  res.end(JSON.stringify({ user: publicUser(user), access: checkAccess(), settings }));
});

route('POST', /^\/api\/logout$/, 'student', (req, res, ctx) => {
  destroySession(ctx.token);
  log(ctx.user, 'logout', '');
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE}`,
  });
  res.end(JSON.stringify({ ok: true }));
});

route('GET', /^\/api\/me$/, 'student', (req, res, ctx) => {
  json(res, 200, { user: publicUser(ctx.user), access: checkAccess(), settings: getSettings() });
});

route('POST', /^\/api\/password$/, 'student', (req, res, ctx) => {
  const { current, next } = ctx.body || {};
  if (!verifyPassword(String(current || ''), ctx.user.password_hash)) {
    return badRequest(res, '현재 비밀번호가 올바르지 않습니다.');
  }
  if (!validPassword(next)) return badRequest(res, '새 비밀번호는 8자 이상이어야 합니다.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(hashPassword(next), ctx.user.id);
  log(ctx.user, 'password_changed', '');
  json(res, 200, { ok: true });
});

// ================= 사용자 관리 =================
route('GET', /^\/api\/users$/, 'instructor', (req, res, ctx) => {
  // 자기보다 낮은 역할만 조회 (슈퍼관리자는 본인 포함 전체 조회)
  const all = db.prepare('SELECT * FROM users ORDER BY role, username').all();
  const visible = ctx.user.role === 'superadmin'
    ? all
    : all.filter((u) => canManage(ctx.user, u.role));
  json(res, 200, { users: visible.map(publicUser) });
});

route('POST', /^\/api\/users$/, 'instructor', (req, res, ctx) => {
  const { username, name, role, password, class_name } = ctx.body || {};
  if (!USERNAME_RE.test(String(username || ''))) {
    return badRequest(res, '아이디는 3~30자의 영문/숫자/._- 만 가능합니다.');
  }
  if (!name || String(name).trim().length === 0) return badRequest(res, '이름을 입력하세요.');
  if (!ROLE_LABELS[role]) return badRequest(res, '올바르지 않은 역할입니다.');
  if (!canManage(ctx.user, role)) return forbidden(res, '자신보다 낮은 권한의 계정만 만들 수 있습니다.');
  if (!validPassword(password)) return badRequest(res, '비밀번호는 8자 이상이어야 합니다.');
  try {
    const r = db.prepare(
      'INSERT INTO users (username, password_hash, name, role, created_by, must_change_password, class_name) VALUES (?, ?, ?, ?, ?, 1, ?)'
    ).run(String(username).trim(), hashPassword(String(password)), String(name).trim(), role, ctx.user.id,
      role === 'student' ? String(class_name || '').trim().slice(0, 50) : '');
    log(ctx.user, 'user_created', `id=${r.lastInsertRowid} username=${username} role=${role}`);
    json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return badRequest(res, '이미 존재하는 아이디입니다.');
    throw e;
  }
});

route('PATCH', /^\/api\/users\/(\d+)$/, 'instructor', (req, res, ctx) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params[0]));
  if (!target) return notFound(res);
  if (!canManage(ctx.user, target.role)) return forbidden(res);
  const { active, name, role, class_name } = ctx.body || {};
  if (class_name !== undefined) {
    db.prepare('UPDATE users SET class_name = ? WHERE id = ?').run(String(class_name).trim().slice(0, 50), target.id);
  }
  if (role !== undefined) {
    if (!ROLE_LABELS[role] || !canManage(ctx.user, role)) return forbidden(res, '해당 역할로 변경할 권한이 없습니다.');
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  }
  if (active !== undefined) {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, target.id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  }
  if (name !== undefined && String(name).trim()) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), target.id);
  }
  log(ctx.user, 'user_updated', `id=${target.id} ${JSON.stringify(ctx.body).slice(0, 200)}`);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/users\/(\d+)\/reset-password$/, 'instructor', (req, res, ctx) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params[0]));
  if (!target) return notFound(res);
  if (!canManage(ctx.user, target.role)) return forbidden(res);
  const { password } = ctx.body || {};
  if (!validPassword(password)) return badRequest(res, '비밀번호는 8자 이상이어야 합니다.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(hashPassword(String(password)), target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  log(ctx.user, 'password_reset', `target=${target.username}`);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/users\/(\d+)$/, 'admin', (req, res, ctx) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(ctx.params[0]));
  if (!target) return notFound(res);
  if (!canManage(ctx.user, target.role)) return forbidden(res);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  log(ctx.user, 'user_deleted', `target=${target.username}`);
  json(res, 200, { ok: true });
});

// ================= 접근 시간표 =================
route('GET', /^\/api\/schedules$/, 'student', (req, res) => {
  json(res, 200, checkAccess());
});

route('POST', /^\/api\/schedules$/, 'admin', (req, res, ctx) => {
  const { day_of_week, start_time, end_time, deck_id } = ctx.body || {};
  const dow = Number(day_of_week);
  const start = toMinutes(String(start_time || ''));
  const end = toMinutes(String(end_time || ''));
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return badRequest(res, '요일이 올바르지 않습니다.');
  if (start === null || end === null) return badRequest(res, '시간 형식은 HH:MM 입니다.');
  if (start >= end) return badRequest(res, '시작 시간은 종료 시간보다 빨라야 합니다.');
  let deckId = null;
  if (deck_id !== undefined && deck_id !== null && deck_id !== '') {
    const deck = db.prepare('SELECT id FROM decks WHERE id = ?').get(Number(deck_id));
    if (!deck) return badRequest(res, '존재하지 않는 웹앱입니다.');
    deckId = deck.id;
  }
  const r = db.prepare('INSERT INTO schedules (day_of_week, start_time, end_time, deck_id, enabled) VALUES (?, ?, ?, ?, 1)')
    .run(dow, start_time, end_time, deckId);
  log(ctx.user, 'schedule_created', `${dow} ${start_time}-${end_time} deck=${deckId ?? '전체'}`);
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

route('PATCH', /^\/api\/schedules\/(\d+)$/, 'admin', (req, res, ctx) => {
  const s = db.prepare('SELECT * FROM schedules WHERE id = ?').get(Number(ctx.params[0]));
  if (!s) return notFound(res);
  const { enabled } = ctx.body || {};
  if (enabled !== undefined) {
    db.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, s.id);
  }
  log(ctx.user, 'schedule_updated', `id=${s.id} enabled=${enabled}`);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/schedules\/(\d+)$/, 'admin', (req, res, ctx) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(Number(ctx.params[0]));
  log(ctx.user, 'schedule_deleted', `id=${ctx.params[0]}`);
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

function deckWithMeta(d) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM slides WHERE deck_id = ?').get(d.id).c;
  const owner = db.prepare('SELECT name FROM users WHERE id = ?').get(d.created_by);
  return {
    ...d, published: !!d.published, slideCount: count, ownerName: owner ? owner.name : '?',
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

route('GET', /^\/api\/decks$/, 'student', (req, res, ctx) => {
  if (ctx.user.role === 'student') {
    const today = todayInTimezone();
    const rows = db.prepare('SELECT * FROM decks WHERE published = 1 ORDER BY updated_at DESC').all()
      .filter((d) => deckVisibleToStudent(d, ctx.user, today));
    const access = checkAccess();
    const decks = rows.map((d) => ({
      ...deckWithMeta(d),
      accessibleNow: access.allowedDeckIds === null || access.allowedDeckIds.includes(d.id),
    }));
    return json(res, 200, { decks });
  }
  const rows = db.prepare('SELECT * FROM decks ORDER BY updated_at DESC').all();
  json(res, 200, { decks: rows.map(deckWithMeta) });
});

route('POST', /^\/api\/decks$/, 'instructor', (req, res, ctx) => {
  const { title, description } = ctx.body || {};
  if (!title || !String(title).trim()) return badRequest(res, '제목을 입력하세요.');
  const r = db.prepare('INSERT INTO decks (title, description, created_by) VALUES (?, ?, ?)')
    .run(String(title).trim(), String(description || '').trim(), ctx.user.id);
  const deckId = Number(r.lastInsertRowid);
  db.prepare("INSERT INTO slides (deck_id, position, title, body) VALUES (?, 0, ?, ?)")
    .run(deckId, String(title).trim(), '## 부제목을 입력하세요');
  log(ctx.user, 'deck_created', `id=${deckId} title=${title}`);
  json(res, 200, { ok: true, id: deckId });
});

route('GET', /^\/api\/decks\/(\d+)$/, 'student', (req, res, ctx) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(Number(ctx.params[0]));
  if (!deck) return notFound(res);
  if (ctx.user.role === 'student') {
    if (!deckVisibleToStudent(deck, ctx.user, todayInTimezone())) {
      return forbidden(res, '열람 권한이 없는 자료입니다.');
    }
    const access = checkAccess(deck.id);
    if (!access.allowed) {
      log(ctx.user, 'time_blocked', `deck=${deck.id}`, req);
      return json(res, 403, { error: 'time_blocked', message: '이 웹앱은 지금 접근이 허용된 시간이 아닙니다.', access });
    }
  }
  const slides = db.prepare('SELECT * FROM slides WHERE deck_id = ? ORDER BY position, id').all(deck.id);
  if (ctx.user.role === 'student') log(ctx.user, 'deck_viewed', `id=${deck.id} title=${deck.title}`, req);
  json(res, 200, { deck: deckWithMeta(deck), slides, canEdit: ctx.user.role !== 'student' && canEditDeck(ctx.user, deck) });
});

route('PATCH', /^\/api\/decks\/(\d+)$/, 'instructor', (req, res, ctx) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(Number(ctx.params[0]));
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { title, description, published, target_classes, access_start, access_end } = ctx.body || {};
  if (title !== undefined && String(title).trim()) {
    db.prepare('UPDATE decks SET title = ? WHERE id = ?').run(String(title).trim(), deck.id);
  }
  if (description !== undefined) {
    db.prepare('UPDATE decks SET description = ? WHERE id = ?').run(String(description).trim(), deck.id);
  }
  if (published !== undefined) {
    db.prepare('UPDATE decks SET published = ? WHERE id = ?').run(published ? 1 : 0, deck.id);
  }
  if (target_classes !== undefined) {
    db.prepare('UPDATE decks SET target_classes = ? WHERE id = ?').run(String(target_classes).trim().slice(0, 300), deck.id);
  }
  const DATE_RE = /^(\d{4}-\d{2}-\d{2})?$/;
  if (access_start !== undefined && DATE_RE.test(String(access_start).trim())) {
    db.prepare('UPDATE decks SET access_start = ? WHERE id = ?').run(String(access_start).trim(), deck.id);
  }
  if (access_end !== undefined && DATE_RE.test(String(access_end).trim())) {
    db.prepare('UPDATE decks SET access_end = ? WHERE id = ?').run(String(access_end).trim(), deck.id);
  }
  db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(deck.id);
  log(ctx.user, 'deck_updated', `id=${deck.id}`);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/decks\/(\d+)$/, 'instructor', (req, res, ctx) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(Number(ctx.params[0]));
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);
  log(ctx.user, 'deck_deleted', `id=${deck.id} title=${deck.title}`);
  json(res, 200, { ok: true });
});

// ---- 슬라이드 ----
const SLIDE_BGS = new Set(['theme-navy', 'theme-white', 'theme-mint', 'theme-sunset', 'theme-violet', 'theme-dark']);
const SLIDE_ALIGNS = new Set(['left', 'center']);

route('POST', /^\/api\/decks\/(\d+)\/slides$/, 'instructor', (req, res, ctx) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(Number(ctx.params[0]));
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const max = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM slides WHERE deck_id = ?').get(deck.id).m;
  const r = db.prepare('INSERT INTO slides (deck_id, position) VALUES (?, ?)').run(deck.id, max + 1);
  json(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
});

function getSlideDeck(slideId) {
  const slide = db.prepare('SELECT * FROM slides WHERE id = ?').get(slideId);
  if (!slide) return {};
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(slide.deck_id);
  return { slide, deck };
}

route('PATCH', /^\/api\/slides\/(\d+)$/, 'instructor', (req, res, ctx) => {
  const { slide, deck } = getSlideDeck(Number(ctx.params[0]));
  if (!slide) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { title, body, bg, align } = ctx.body || {};
  if (title !== undefined) db.prepare('UPDATE slides SET title = ? WHERE id = ?').run(String(title).slice(0, 200), slide.id);
  if (body !== undefined) db.prepare('UPDATE slides SET body = ? WHERE id = ?').run(String(body).slice(0, 20000), slide.id);
  if (bg !== undefined && SLIDE_BGS.has(bg)) db.prepare('UPDATE slides SET bg = ? WHERE id = ?').run(bg, slide.id);
  if (align !== undefined && SLIDE_ALIGNS.has(align)) db.prepare('UPDATE slides SET align = ? WHERE id = ?').run(align, slide.id);
  db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(deck.id);
  json(res, 200, { ok: true });
});

route('DELETE', /^\/api\/slides\/(\d+)$/, 'instructor', (req, res, ctx) => {
  const { slide, deck } = getSlideDeck(Number(ctx.params[0]));
  if (!slide) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  db.prepare('DELETE FROM slides WHERE id = ?').run(slide.id);
  json(res, 200, { ok: true });
});

route('POST', /^\/api\/decks\/(\d+)\/reorder$/, 'instructor', (req, res, ctx) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(Number(ctx.params[0]));
  if (!deck) return notFound(res);
  if (!canEditDeck(ctx.user, deck)) return forbidden(res);
  const { ids } = ctx.body || {};
  if (!Array.isArray(ids)) return badRequest(res, 'ids 배열이 필요합니다.');
  const upd = db.prepare('UPDATE slides SET position = ? WHERE id = ? AND deck_id = ?');
  ids.forEach((id, i) => upd.run(i, Number(id), deck.id));
  json(res, 200, { ok: true });
});

// ================= 보안 설정 =================
const BOOL_SETTING_KEYS = new Set([
  'block_capture', 'block_copy', 'block_rightclick', 'watermark',
  'devtools_detect', 'single_session', 'ip_restrict', 'two_factor',
]);

route('GET', /^\/api\/settings$/, 'student', (req, res, ctx) => {
  const settings = getSettings();
  // 학생에게는 IP 허용 목록 값 자체는 노출하지 않는다
  if (ctx.user.role === 'student') delete settings.ip_allowlist;
  json(res, 200, { settings });
});

route('PATCH', /^\/api\/settings$/, 'admin', (req, res, ctx) => {
  for (const [k, v] of Object.entries(ctx.body || {})) {
    if (BOOL_SETTING_KEYS.has(k)) setSetting(k, !!v);
    else if (k === 'ip_allowlist') setSetting(k, String(v ?? '').slice(0, 1000));
  }
  log(ctx.user, 'settings_updated', JSON.stringify(ctx.body).slice(0, 200), req);
  json(res, 200, { settings: getSettings() });
});

// ================= 대시보드 통계 =================
route('GET', /^\/api\/dashboard$/, 'instructor', (req, res) => {
  const count = (sql) => db.prepare(sql).get().c;
  json(res, 200, {
    stats: {
      decks: count('SELECT COUNT(*) AS c FROM decks'),
      publishedDecks: count("SELECT COUNT(*) AS c FROM decks WHERE published = 1"),
      decksDelta: count("SELECT COUNT(*) AS c FROM decks WHERE created_at >= datetime('now', '-7 days')"),
      instructors: count("SELECT COUNT(*) AS c FROM users WHERE role = 'instructor' AND active = 1"),
      instructorsDelta: count("SELECT COUNT(*) AS c FROM users WHERE role = 'instructor' AND created_at >= datetime('now', '-7 days')"),
      students: count("SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND active = 1"),
      studentsDelta: count("SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND created_at >= datetime('now', '-7 days')"),
      todayLogins: count("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'login' AND created_at >= date('now')"),
      yesterdayLogins: count("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'login' AND created_at >= date('now', '-1 day') AND created_at < date('now')"),
      todayBlocked: count("SELECT COUNT(*) AS c FROM audit_logs WHERE action IN ('time_blocked','ip_blocked') AND created_at >= date('now')"),
      captureAttempts: count("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'capture_attempt'"),
      warnings: count("SELECT COUNT(*) AS c FROM audit_logs WHERE action IN ('capture_attempt','multi_session','ip_blocked','otp_failed','login_failed') AND created_at >= datetime('now', '-1 day')"),
    },
    recentLogs: db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 8').all(),
    alerts: db.prepare("SELECT * FROM audit_logs WHERE action IN ('capture_attempt','multi_session','ip_blocked','otp_failed','time_blocked','login_failed') ORDER BY id DESC LIMIT 6").all(),
  });
});

// ================= 리포트 =================
route('GET', /^\/api\/report$/, 'admin', (req, res) => {
  const daily = db.prepare(`
    SELECT date(created_at) AS day,
      SUM(CASE WHEN action = 'login' THEN 1 ELSE 0 END) AS logins,
      SUM(CASE WHEN action IN ('time_blocked','ip_blocked') THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN action = 'capture_attempt' THEN 1 ELSE 0 END) AS captures
    FROM audit_logs
    WHERE created_at >= date('now', '-6 days')
    GROUP BY date(created_at) ORDER BY day
  `).all();
  const topDecks = db.prepare(`
    SELECT detail, COUNT(*) AS views FROM audit_logs
    WHERE action = 'deck_viewed' GROUP BY detail ORDER BY views DESC LIMIT 5
  `).all();
  const byAction = db.prepare(`
    SELECT action, COUNT(*) AS cnt FROM audit_logs
    WHERE action IN ('login','time_blocked','ip_blocked','capture_attempt','login_failed','multi_session')
    GROUP BY action
  `).all();
  const activeStudents = db.prepare(`
    SELECT username, COUNT(*) AS cnt FROM audit_logs
    WHERE action = 'deck_viewed' AND created_at >= datetime('now', '-7 days')
    GROUP BY username ORDER BY cnt DESC LIMIT 5
  `).all();
  json(res, 200, { daily, topDecks, byAction, activeStudents });
});

// ================= 로그 / 캡처 신고 =================
route('GET', /^\/api\/logs$/, 'admin', (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all();
  json(res, 200, { logs: rows });
});

// 클라이언트에서 감지한 캡처/복제 시도를 기록한다.
route('POST', /^\/api\/report-capture$/, 'student', (req, res, ctx) => {
  const { type, detail } = ctx.body || {};
  log(ctx.user, 'capture_attempt', `type=${String(type).slice(0, 50)} ${String(detail || '').slice(0, 200)}`, req);
  json(res, 200, { ok: true });
});

// ================= 디스패처 =================
function handleApi(req, res, pathname, body) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;

    // 인증
    let user = null;
    let token = null;
    if (r.minRole !== null) {
      const session = getSessionUser(req);
      if (!session) return json(res, 401, { error: '로그인이 필요합니다.' });
      user = session.user;
      token = session.token;
      if (roleLevel(user.role) < roleLevel(r.minRole)) return forbidden(res);

      // 학생 시간제한: 예외 경로가 아니면 허용 시간 밖에서 403
      if (user.role === 'student' && !STUDENT_EXEMPT.some((re) => re.test(pathname))) {
        const access = checkAccess();
        if (!access.allowed) {
          log(user, 'time_blocked', pathname, req);
          return json(res, 403, { error: 'time_blocked', message: '지금은 접근이 허용된 시간이 아닙니다.', access });
        }
      }
    }
    return r.handler(req, res, { user, token, params: m.slice(1), body });
  }
  notFound(res);
}

module.exports = { handleApi };
