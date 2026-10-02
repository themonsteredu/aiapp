'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerCareerLogRoutes, digest, submission } = require('../lib/career-log');
const sid = crypto.randomUUID();
const schoolSid = crypto.randomUUID();
const schoolAccountId = crypto.randomUUID();
const guestKey = 'a'.repeat(64);
const roles = { student: 0, instructor: 1, admin: 2, superadmin: 3 };
const ctx = (extra = {}) => ({ user: { id: 12, role: 'student', name: '검증용 학생', guest_session_id: null }, token: 'session-one', ...extra });
const payload = () => ({ deck_id: 7, attempt_id: crypto.randomUUID(), process: '증거의 시간을 비교했습니다.', artifact: '증거 비교 보고서', reflection: '첫 판단을 수정했습니다.' });
function fixture(options = {}) {
  const routes = [], trace = [], records = [], identities = options.empty ? [] : [{ student_id: sid, account_user_id: 12, guest_key_hash: digest(guestKey) }];
  let lock = Promise.resolve();
  const deck = { id: 7, title: '디지털 포렌식', created_by: 21, published: true };
  async function one(sql, values = []) {
    trace.push({ sql, values });
    if (sql.includes('FROM career_log.job_identities')) return identities.find(item => sql.includes('account_user_id') ? item.account_user_id === values[0] : item.guest_key_hash === values[0]) || null;
    if (sql.includes('FROM decks')) return deck;
    if (sql.includes('FROM career_log.records')) return records.find(item => item.source_event_id === values[0] && item.student_id === values[1]) || null;
    if (sql.includes('INSERT INTO career_log.records')) {
      if (options.failWrite) throw new Error('database unavailable');
      const item = { id: crypto.randomUUID(), student_id: values[0], session_ref: values[1], program_ref: values[2], process: values[3], artifact: values[4], reflection: values[5], raw_data: JSON.parse(values[6]), source_event_id: values[7], source: 'job' };
      records.push(item); return item;
    }
    throw new Error('Unhandled one: ' + sql);
  }
  async function q(sql, values = []) {
    trace.push({ sql, values });
    if (sql.includes('INSERT INTO career_log.job_identities')) identities.push({ student_id: values[0], account_user_id: values[1], guest_key_hash: values[2] });
    if (sql.includes('FROM career_record_photos')) return (options.photos || []).filter(photo => values[0].includes(photo.record_id));
    if (sql.includes('FROM career_log.records')) return options.listRows || [];
    return [];
  }
  async function withTransaction(work) {
    let release;
    const txQ = async (sql, values) => {
      if (sql.includes('pg_advisory_xact_lock')) { const previous = lock; lock = new Promise(resolve => { release = resolve; }); await previous; }
      return q(sql, values);
    };
    try { return await work({ one, q: txQ }); } finally { if (release) release(); }
  }
  registerCareerLogRoutes({ route: (method, pattern, minRole, handler) => routes.push({ method, pattern, minRole, handler }), q, one, withTransaction,
    json: (res, status, body) => { res.status = status; res.body = body; }, roleLevel: role => roles[role] ?? -1,
    guestDeckAccess: async () => ({ allowed: !options.locked }), deckVisibleToStudent: () => !options.locked,
    checkAccess: async () => ({ allowed: !options.timeBlocked }), todayInTimezone: () => '2026-09-06', cookieSecure: '; Secure',
    schoolStudentId: async user => (user.school_account_id === schoolAccountId && !options.schoolInactive ? schoolSid : null),
    photoForStudent: async (studentUuid, photoId) => {
      const photo = (options.photos || []).find(item => item.id === photoId && item.student_uuid === studentUuid);
      if (!photo) throw Object.assign(new Error('사진을 찾을 수 없습니다.'), { status: 404 });
      return photo;
    },
    photoForStaff: async (user, photoId) => {
      const photo = (options.photos || []).find(item => item.id === photoId);
      if (!photo || !options.staffMaySeePhoto) throw Object.assign(new Error('이 사진을 볼 권한이 없습니다.'), { status: 403 });
      return photo;
    } });
  async function call(method, path, context = ctx(), body = {}, extraHeaders = {}) {
    const route = routes.find(item => item.method === method && item.pattern.test(path.split('?')[0]));
    assert.ok(route, path); assert.notEqual(route.minRole, null);
    const params = route.pattern.exec(path.split('?')[0]).slice(1);
    const req = { method, url: path, headers: { host: 'job.moakit.ai', origin: 'https://job.moakit.ai', ...extraHeaders } };
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); return this; },
      end(value) { this.bytes = value; } };
    await route.handler(req, res, { params, ...context, body }); return res;
  }
  return { call, records, identities, trace };
}

test('validation requires a real attempt UUID and meaningful process/reflection', () => {
  assert.equal(submission({ ...payload(), reflection: ' ' }), null);
  assert.equal(submission({ ...payload(), attempt_id: '../../other' }), null);
  assert.equal(submission({ ...payload(), process: 'x'.repeat(1501) }), null);
  assert.ok(submission(payload()));
});
test('cross-site writes and staff pretending to be students are rejected', async () => {
  const app = fixture();
  assert.equal((await app.call('POST', '/api/career-log/records', ctx(), payload(), { origin: 'https://other.example' })).status, 403);
  assert.equal((await app.call('POST', '/api/career-log/records', ctx({ user: { id: 21, role: 'instructor' } }), payload())).status, 403);
  assert.equal(app.records.length, 0);
});
test('client student IDs cannot claim an identity or read another student', async () => {
  const app = fixture();
  const stranger = ctx({ user: { id: 99, role: 'student' } });
  const result = await app.call('GET', `/api/career-log/records?student_id=${sid}`, stranger);
  assert.equal(result.body.needsStart, true);
  assert.deepEqual(result.body.records, []);
});
test('guest access is bound to this login session, not a shared project username', async () => {
  const app = fixture();
  const guest = ctx({ user: { id: 12, role: 'student', guest_session_id: 5 } });
  const header = { cookie: `job_career_access=${guestKey}.${digest('old-session')}; job_career_resume=${guestKey}` };
  const result = await app.call('GET', '/api/career-log/profile', guest, {}, header);
  assert.equal(result.body.active, false);
  assert.equal(result.body.canResume, true);
  assert.equal((await app.call('GET', '/api/career-log/records', guest, {}, header)).body.needsStart, true);
});
test('explicit guest resume keeps the random student identity and uses HttpOnly credentials', async () => {
  const app = fixture();
  const guest = ctx({ user: { id: 42, role: 'student', guest_session_id: 5 } });
  const result = await app.call('POST', '/api/career-log/start', guest, { mode: 'resume', student_id: crypto.randomUUID() }, { cookie: `job_career_resume=${guestKey}` });
  assert.equal(result.status, 200);
  assert.equal(app.identities.length, 1);
  assert.equal(app.identities[0].student_id, sid);
  assert.ok(result.headers['Set-Cookie'].every(value => value.includes('HttpOnly') && value.includes('Secure') && value.includes('SameSite=Strict')));
  assert.equal(JSON.stringify(result.body).includes(guestKey), false);
});
test('a fresh guest gets an independent UUID and stores only a credential hash', async () => {
  const app = fixture({ empty: true });
  const guest = ctx({ user: { id: 42, role: 'student', guest_session_id: 5 } });
  const result = await app.call('POST', '/api/career-log/start', guest, { mode: 'new', student_id: sid });
  assert.equal(result.status, 200);
  assert.notEqual(app.identities[0].student_id, sid);
  assert.equal(app.identities[0].account_user_id, null);
  const key = /job_career_resume=([^;]+)/.exec(result.headers['Set-Cookie'][0])[1];
  assert.equal(app.identities[0].guest_key_hash, digest(key));
});
test('account identity is created once when two tabs start together', async () => {
  const app = fixture({ empty: true });
  await Promise.all([app.call('POST', '/api/career-log/start'), app.call('POST', '/api/career-log/start')]);
  assert.equal(app.identities.length, 1);
  assert.equal(app.identities[0].account_user_id, 12);
});
test('locked or unavailable lesson submissions do not reach record storage', async () => {
  for (const options of [{ locked: true }, { timeBlocked: true }]) {
    const app = fixture(options);
    assert.equal((await app.call('POST', '/api/career-log/records', ctx(), payload())).status, 403);
    assert.equal(app.records.length, 0);
  }
});
test('a write uses server identity, lesson and teacher scope; client verification claims are ignored', async () => {
  const app = fixture();
  const input = { ...payload(), student_id: crypto.randomUUID(), verification_status: 'verified', raw_data: { job: { teacher_ids: [999] } } };
  const result = await app.call('POST', '/api/career-log/records', ctx(), input);
  assert.equal(result.status, 201);
  assert.equal(app.records[0].student_id, sid);
  assert.equal(app.records[0].program_ref, 'job-deck:7');
  assert.deepEqual(app.records[0].raw_data.job.teacher_ids, [21]);
  const insert = app.trace.find(item => item.sql.includes('INSERT INTO career_log.records'));
  assert.match(insert.sql, /'job', NULL, NULL, NULL/);
});
test('concurrent retries produce one stored record and the same receipt', async () => {
  const app = fixture(), body = payload();
  const results = await Promise.all([app.call('POST', '/api/career-log/records', ctx(), body), app.call('POST', '/api/career-log/records', ctx(), body)]);
  assert.equal(app.records.length, 1);
  assert.equal(results[0].body.id, results[1].body.id);
  assert.deepEqual(results.map(item => item.status).sort(), [200, 201]);
});
test('a retry with changed content is a conflict and never overwrites the original', async () => {
  const app = fixture(), body = payload();
  await app.call('POST', '/api/career-log/records', ctx(), body);
  assert.equal((await app.call('POST', '/api/career-log/records', ctx(), { ...body, reflection: 'changed' })).status, 409);
  assert.equal(app.records[0].reflection, body.reflection);
  assert.equal(app.records.length, 1);
});
test('student and instructor list queries retain ownership restrictions despite forged filters', async () => {
  const app = fixture();
  await app.call('GET', '/api/career-log/records?class=job-class:999&student_id=attacker');
  let query = app.trace.filter(item => item.sql.includes('FROM career_log.records')).at(-1);
  assert.match(query.sql, /r.student_id = \$1/); assert.equal(query.values[0], sid);
  await app.call('GET', '/api/career-log/records?class=job-class:999', ctx({ user: { id: 21, role: 'instructor' } }));
  query = app.trace.filter(item => item.sql.includes('FROM career_log.records')).at(-1);
  assert.match(query.sql, /teacher_ids/); assert.equal(query.values[0], '[21]');
});
test('storage failure never produces a saved response', async () => {
  const app = fixture({ failWrite: true });
  await assert.rejects(app.call('POST', '/api/career-log/records', ctx(), payload()), /database unavailable/);
  assert.equal(app.records.length, 0);
});

// ---- 모아허브 학교 학생 계정으로 로그인한 학생 ----
const schoolCtx = () => ctx({ user: { id: 77, role: 'student', name: '김모아', guest_session_id: null, school_account_id: schoolAccountId } });
test('학교 계정 학생은 시작 단계 없이 계정의 학생 번호로 기록을 저장한다', async () => {
  const app = fixture({ empty: true });
  const profile = await app.call('GET', '/api/career-log/profile', schoolCtx());
  assert.equal(profile.body.active, true);
  assert.equal(profile.body.school, true);
  const result = await app.call('POST', '/api/career-log/records', schoolCtx(), payload());
  assert.equal(result.status, 201);
  assert.equal(app.records[0].student_id, schoolSid, '모아허브 학교 수업 기록과 같은 학생 번호');
  assert.equal(app.records[0].raw_data.job.identity, 'school-account');
  assert.equal(app.identities.length, 0, 'job_identities 에 별도 번호를 만들지 않는다');
});
test('학교 계정 학생의 기록 조회는 출처를 가리지 않아 모아허브 기록도 같은 번호로 나온다', async () => {
  const app = fixture({ empty: true });
  const result = await app.call('GET', '/api/career-log/records', schoolCtx());
  assert.equal(result.status, 200);
  const listSql = app.trace.findLast(item => item.sql.includes('FROM career_log.records r WHERE'));
  assert.equal(listSql.values[0], schoolSid);
  assert.equal(listSql.sql.includes("r.source = 'job' AND r.student_id"), false);
  assert.match(listSql.sql, /r\.source, r\.program_ref/);
});
test('비활성 학교 계정은 기록을 시작하거나 저장할 수 없다', async () => {
  const app = fixture({ empty: true, schoolInactive: true });
  assert.equal((await app.call('POST', '/api/career-log/start', schoolCtx())).status, 403);
  assert.equal((await app.call('POST', '/api/career-log/records', schoolCtx(), payload())).status, 409);
  assert.equal(app.records.length, 0);
  assert.equal(app.identities.length, 0);
});

// ---- 담당자가 남긴 진로 관찰 기록의 활동 사진 ----
const photoId = crypto.randomUUID();
const photoRow = { id: photoId, record_id: 'rec-1', student_uuid: sid, mime: 'image/jpeg', data: Buffer.from('사진').toString('base64'), caption: '시뮬레이터 실습' };
const observationRow = { id: 'rec-1', occurred_at: '2026-09-11T00:00:00Z', process: '관제 시뮬레이터를 조작', artifact: '설명하는 힘', reflection: '공항 견학', source: 'job', program_ref: 'job-career-observation', entry_kind: 'career_observation', observation: { activity: '관제 시뮬레이터를 조작' }, supersedes_id: null };

test('학생 목록에는 사진 이름표만 나오고 사진 자체는 내려가지 않는다', async () => {
  const app = fixture({ listRows: [observationRow], photos: [photoRow] });
  const result = await app.call('GET', '/api/career-log/records');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.records[0].photos, [{ id: photoId, mime: 'image/jpeg', caption: '시뮬레이터 실습' }]);
  assert.equal(result.body.records[0].photos[0].data, undefined);
  assert.equal(result.body.records[0].observation.activity, '관제 시뮬레이터를 조작');
});

test('활동 사진은 본인 학생 번호로만 열리고 응답을 저장하지 않는다', async () => {
  const app = fixture({ photos: [photoRow] });
  const ok = await app.call('GET', `/api/career-photos/${photoId}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Content-Type'], 'image/jpeg');
  assert.equal(ok.headers['Cache-Control'], 'private, no-store');
  assert.equal(ok.bytes.toString('utf8'), '사진');
  // 다른 학생 번호의 사진은 404
  const other = fixture({ photos: [{ ...photoRow, student_uuid: crypto.randomUUID() }] });
  assert.equal((await other.call('GET', `/api/career-photos/${photoId}`)).body.error, '사진을 찾을 수 없습니다.');
});

test('기록을 시작하지 않은 학생은 사진을 열 수 없고, 권한 없는 담당자도 막힌다', async () => {
  const none = fixture({ empty: true, photos: [photoRow] });
  const blocked = await none.call('GET', `/api/career-photos/${photoId}`);
  assert.equal(blocked.status, 403);
  const staff = fixture({ photos: [photoRow] });
  const denied = await staff.call('GET', `/api/career-photos/${photoId}`, ctx({ user: { id: 91, role: 'partner', name: '진로업체' } }));
  assert.equal(denied.status, 403);
  const allowed = fixture({ photos: [photoRow], staffMaySeePhoto: true });
  assert.equal((await allowed.call('GET', `/api/career-photos/${photoId}`, ctx({ user: { id: 91, role: 'partner', name: '진로업체' } }))).status, 200);
});

test('작성자 이름은 담당자가 쓴 기록(관찰·담당자 기록·정정본)에만 실린다', async () => {
  const app = fixture({ listRows: [{ ...observationRow, author_name: '모아킷 진로 강사' }] });
  const result = await app.call('GET', '/api/career-log/records');
  assert.equal(result.body.records[0].author_name, '모아킷 진로 강사');
  const listSql = app.trace.findLast(item => item.sql.includes('FROM career_log.records r WHERE')).sql;
  assert.match(listSql, /CASE WHEN r\.raw_data->'job'->>'entry_kind' IN \('career_observation', 'staff_record', 'revision'\)\s+THEN r\.raw_data->'job'->>'author_name' END AS author_name/);
  assert.equal(/'author_name' AS author_name/.test(listSql), false, '조건 없이 모든 기록에 싣지 않는다');
});

// ---- 관찰 기록의 제목·웹앱 줄: 모아허브 학생 화면(student-accounts.js)과 같은 규칙 ----
test('기록 목록은 제목과 웹앱 이름을 따로 싣는다 — 웹앱 이름을 제목 칸에 섞지 않는다', async () => {
  const app = fixture();
  await app.call('GET', '/api/career-log/records');
  const listSql = app.trace.findLast(item => item.sql.includes('FROM career_log.records r WHERE')).sql;
  assert.match(listSql, /r\.raw_data->'job'->>'title' AS title/);
  assert.match(listSql, /r\.raw_data->'job'->>'deck_title' AS deck_title/);
  assert.equal(/COALESCE\([^)]*deck_title/.test(listSql), false);
});

test('내 진로기록 화면: 관찰 기록은 웹앱 이름을 제목 대신 웹앱: 줄로, 학생 기록은 웹앱 이름을 제목으로', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  process.removeAllListeners('warning');
  const { recordHeading, recordDeckLine } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'career-log-ui.js')).href);
  const linked = { ...observationRow, title: '포렌식 웹앱 관찰', deck_title: '디지털 포렌식' };
  assert.equal(recordHeading(linked), '포렌식 웹앱 관찰');
  assert.equal(recordDeckLine(linked), '웹앱: 디지털 포렌식');
  // 제목 없는 관찰 기록은 웹앱 이름이 아니라 '진로 관찰 기록' (모아허브 heading 규칙과 같다).
  assert.equal(recordHeading({ ...linked, title: null }), '진로 관찰 기록');
  // 정정본(entry_kind='revision')도 관찰 기록으로 읽는다.
  assert.equal(recordDeckLine({ ...linked, entry_kind: 'revision', program_ref: 'job-career-observation' }), '웹앱: 디지털 포렌식');
  // 학생이 웹앱에서 직접 쓴 기록은 웹앱 이름이 제목이고 웹앱: 줄은 없다.
  const student = { source: 'job', program_ref: 'job-deck:7', entry_kind: 'student_reflection', title: null, deck_title: '디지털 포렌식', observation: null };
  assert.equal(recordHeading(student), '디지털 포렌식');
  assert.equal(recordDeckLine(student), '');
  assert.equal(recordDeckLine({ ...observationRow, deck_title: null }), '', '웹앱을 잇지 않은 관찰 기록');
  assert.equal(recordHeading({ source: 'hub', program_ref: 'science-observation-ai-03', title: null }), '자연을 관찰하는 AI');
});

// ---- 쓴 사람·고친 사람 줄: 모아허브 writerOf · 담당자 기록 화면과 같은 규칙 ----
test('학생 목록은 정정본에 고친 사람(revised_by_name)을 함께 싣는다', async () => {
  const app = fixture({ listRows: [{ ...observationRow, supersedes_id: 'rec-0', entry_kind: 'revision', author_name: '김진로', revised_by_name: '모아킷 관리자' }] });
  const result = await app.call('GET', '/api/career-log/records');
  assert.equal(result.body.records[0].revised_by_name, '모아킷 관리자');
  const listSql = app.trace.findLast(item => item.sql.includes('FROM career_log.records r WHERE')).sql;
  assert.match(listSql, /CASE WHEN r\.raw_data->'job'->>'entry_kind' = 'revision' THEN r\.raw_data->'job'->>'revised_by_name' END AS revised_by_name/);
});

test('내 진로기록 화면: 담당자가 쓴 기록은 작성·정정을 나눠 보이고, 학생 글을 고친 정정본은 고친 사람만', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  process.removeAllListeners('warning');
  const { recordWriter } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'career-log-ui.js')).href);
  // 담당자가 쓴 관찰 기록·담당자 기록
  assert.equal(recordWriter({ ...observationRow, author_name: '김진로' }), '작성: 김진로');
  assert.equal(recordWriter({ program_ref: 'job-staff-record', entry_kind: 'staff_record', author_name: '김진로' }), '작성: 김진로');
  // 그 기록을 다른 사람이 고친 정정본 (정정본의 entry_kind 는 'revision' — 담당자 기록은 program_ref 로 가린다)
  assert.equal(recordWriter({ ...observationRow, entry_kind: 'revision', supersedes_id: 'r1', author_name: '김진로', revised_by_name: '모아킷 관리자' }), '작성: 김진로 · 정정: 모아킷 관리자');
  assert.equal(recordWriter({ program_ref: 'job-staff-record', entry_kind: 'revision', supersedes_id: 'r1', author_name: '김진로', revised_by_name: '모아킷 관리자' }), '작성: 김진로 · 정정: 모아킷 관리자');
  // 학생이 쓴 기록을 담당자가 고친 정정본: 고친 사람만
  const student = { source: 'job', program_ref: 'job-deck:7', entry_kind: 'revision', supersedes_id: 'r2', observation: null };
  assert.equal(recordWriter({ ...student, revised_by_name: '모아킷 관리자' }), '정정: 모아킷 관리자');
  assert.equal(recordWriter({ source: 'hub', program_ref: 'science-observation-ai-03', entry_kind: 'revision', supersedes_id: 'r3', revised_by_name: '모아킷 관리자' }), '정정: 모아킷 관리자');
  // 예전 정정본(revised_by_name 없음)은 author_name 이 고친 사람이었다 — '정정:'으로 읽는다
  assert.equal(recordWriter({ ...student, author_name: '예전에 고친 사람' }), '정정: 예전에 고친 사람');
  assert.equal(recordWriter({ ...observationRow, entry_kind: 'revision', supersedes_id: 'r1', author_name: '예전에 고친 사람' }), '정정: 예전에 고친 사람');
  // 학생이 직접 쓴 기록에는 쓴 사람 줄이 없다 (값이 끼어 있어도)
  assert.equal(recordWriter({ source: 'job', program_ref: 'job-deck:7', entry_kind: 'student_reflection', author_name: '끼어든 이름' }), '');
  assert.equal(recordWriter({ ...observationRow, author_name: null }), '');
});

test('담당자 기록 화면(public/school-accounts-ui.js)도 같은 쓴 사람 규칙을 가져다 쓴다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'school-accounts-ui.js'), 'utf8');
  assert.ok(source.includes("import { recordWriter, recordSession } from './career-log-ui.js';"));
  assert.match(source, /const subLine = \(r, heading\) => \[recordSession\(r, heading\), recordWriter\(r\)/);
  assert.equal(/r\.author_name/.test(source), false, '작성자 이름을 규칙 없이 그대로 붙이지 않는다');
});

// E2E 화면 확인에서 나온 것: 담당자 기록·웹앱 기록은 수업 이름(session_title)이 제목과 같아 제목이 두 줄 연달아 보였다.
test('제목 아래 수업 이름 줄은 제목과 같으면 싣지 않는다 (학생 화면·담당자 화면 공통)', async () => {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  process.removeAllListeners('warning');
  const { recordSession, recordHeading } = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'career-log-ui.js')).href);
  const observation = { ...observationRow, title: '직업 탐색 카드 활동 관찰', session_title: '직업 탐색 카드 활동 관찰', deck_title: '직업 탐색 카드' };
  assert.equal(recordSession(observation, recordHeading(observation)), '');
  const student = { source: 'job', program_ref: 'job-deck:1', entry_kind: 'student_reflection', title: null, deck_title: '직업 탐색 카드', session_title: '직업 탐색 카드', observation: null };
  assert.equal(recordSession(student, recordHeading(student)), '');
  // 수업 코드로 참여한 수업처럼 이름이 다르면 그대로 보인다. 앞뒤 공백은 같은 것으로 본다.
  assert.equal(recordSession({ ...student, session_title: '3학년 2반 진로 수업' }, recordHeading(student)), '3학년 2반 진로 수업');
  assert.equal(recordSession({ ...student, session_title: ' 직업 탐색 카드 ' }, '직업 탐색 카드'), '');
  assert.equal(recordSession({ ...student, session_title: null }, '직업 탐색 카드'), '');
  const fs = require('node:fs');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'career-log-ui.js'), 'utf8');
  assert.match(ui, /recordSession\(record, heading\)/);
  assert.equal(ui.includes("esc(record.session_title || '')"), false, '수업 이름을 규칙 없이 그대로 싣지 않는다');
});
