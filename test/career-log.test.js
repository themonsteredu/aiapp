'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { registerCareerLogRoutes, digest, submission } = require('../lib/career-log');
const sid = crypto.randomUUID();
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
    if (sql.includes('FROM career_log.records')) return [];
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
    checkAccess: async () => ({ allowed: !options.timeBlocked }), todayInTimezone: () => '2026-09-06', cookieSecure: '; Secure' });
  async function call(method, path, context = ctx(), body = {}, extraHeaders = {}) {
    const route = routes.find(item => item.method === method && item.pattern.test(path.split('?')[0]));
    assert.ok(route, path); assert.notEqual(route.minRole, null);
    const req = { method, url: path, headers: { host: 'job.moakit.ai', origin: 'https://job.moakit.ai', ...extraHeaders } };
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    await route.handler(req, res, { ...context, body }); return res;
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
