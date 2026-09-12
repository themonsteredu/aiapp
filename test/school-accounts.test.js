'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { isSchoolUsername, passwordHash, passwordMatches, className, createSchoolAccounts } = require('../lib/school-accounts');

const accountId = crypto.randomUUID();
const careerId = crypto.randomUUID();
const username = 'm' + crypto.randomBytes(10).toString('hex');

// 모아허브 명단·계정 테이블과 모아랩 users 테이블을 흉내 낸다.
async function fixture(options = {}) {
  const hash = await passwordHash(options.password || 'temporary-pass');
  const accounts = [{ id: accountId, career_student_id: careerId, username, password_hash: hash, must_change_password: options.mustChange !== false, active: options.inactive ? false : true }];
  const memberships = options.noMembership ? [] : [{ account_id: accountId, display_name: '김모아', class_name: '2학년 1반 3번', school_name: '모아초등학교', active: true }];
  const users = options.users ? [...options.users] : [];
  const hubSessions = [{ account_id: accountId }];
  const limits = new Map();
  const trace = [];
  let nextId = 100;
  async function one(sql, values = []) {
    trace.push(sql);
    if (sql.includes('FROM moakit_accounts.accounts WHERE username')) return accounts.find(a => a.username === values[0]) || null;
    if (sql.includes('FROM moakit_accounts.accounts WHERE id = $1 AND active')) { const a = accounts.find(a => a.id === values[0] && a.active); return a ? { career_student_id: a.career_student_id } : null; }
    if (sql.includes('FROM moakit_accounts.accounts WHERE id = $1 FOR UPDATE')) { const a = accounts.find(a => a.id === values[0]); return a ? { password_hash: a.password_hash, active: a.active } : null; }
    if (sql.includes('FROM moakit_accounts.memberships m')) return memberships.find(m => m.account_id === values[0] && m.active) || null;
    if (sql.includes('FROM users WHERE school_account_id')) return users.find(u => u.school_account_id === values[0]) || null;
    if (sql.includes('FROM users WHERE username')) return users.find(u => u.username === values[0]) || null;
    if (sql.startsWith('UPDATE users SET name')) { const u = users.find(u => u.id === values[3]); Object.assign(u, { name: values[0], class_name: values[1], must_change_password: values[2] }); return { ...u }; }
    if (sql.startsWith('INSERT INTO users')) { const u = { id: nextId++, username: values[0], password_hash: values[1], name: values[2], role: 'student', class_name: values[3], must_change_password: values[4], school_account_id: values[5], active: true }; users.push(u); return { ...u }; }
    throw new Error('Unhandled one: ' + sql);
  }
  async function q(sql, values = []) {
    trace.push(sql);
    if (sql.includes('INSERT INTO moakit_accounts.login_limits')) { const n = (limits.get(values[0]) || 0) + 1; limits.set(values[0], n); return [{ attempts: n }]; }
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.startsWith('UPDATE moakit_accounts.accounts SET password_hash')) { const a = accounts.find(a => a.id === values[1]); a.password_hash = values[0]; a.must_change_password = false; return []; }
    if (sql.startsWith('DELETE FROM moakit_accounts.sessions')) { hubSessions.splice(0, hubSessions.length); return []; }
    if (sql.startsWith('UPDATE users SET must_change_password = false')) { users.find(u => u.id === values[0]).must_change_password = false; return []; }
    throw new Error('Unhandled q: ' + sql);
  }
  const withTransaction = work => work({ q, one });
  return { api: createSchoolAccounts({ q, one, withTransaction }), accounts, users, hubSessions, limits, trace };
}
const rejects = (promise, status) => assert.rejects(promise, error => { assert.equal(error.status, status); return true; });

test('모아허브 학생 계정 아이디 형식과 반 이름 변환', () => {
  assert.equal(isSchoolUsername('m0123456789abcdef0123'), true);
  assert.equal(isSchoolUsername('m0123456789ABCDEF0123'), false);
  assert.equal(isSchoolUsername('student01'), false);
  assert.equal(className('모아초등학교', '2학년 1반 3번'), '모아초등학교 2학년 1반');
  assert.equal(className('모아초등학교', '특수반'), '모아초등학교 특수반');
});

test('모아허브와 같은 scrypt1 형식으로 비밀번호를 검증한다', async () => {
  const stored = await passwordHash('correct horse');
  assert.match(stored, /^scrypt1:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(await passwordMatches('correct horse', stored), true);
  assert.equal(await passwordMatches('wrong', stored), false);
  assert.equal(await passwordMatches('correct horse', 'salt:hash'), false);
});

test('첫 로그인은 모아랩 학생 계정을 만들어 연결하고, 다음 로그인은 같은 계정을 다시 쓴다', async () => {
  const app = await fixture();
  const first = await app.api.login(username, 'temporary-pass', '1.2.3.4');
  assert.equal(first.school_account_id, accountId);
  assert.equal(first.username, username);
  assert.equal(first.role, 'student');
  assert.equal(first.name, '김모아');
  assert.equal(first.class_name, '모아초등학교 2학년 1반');
  assert.equal(first.must_change_password, true);
  assert.equal(first.password_hash.includes(':'), false, '모아랩 비밀번호로는 로그인할 수 없어야 한다');
  const second = await app.api.login(username, 'temporary-pass', '1.2.3.4');
  assert.equal(second.id, first.id);
  assert.equal(app.users.length, 1);
});

test('틀린 비밀번호·비활성 계정·소속 없는 계정은 거절하고 시도 횟수는 남는다', async () => {
  const app = await fixture();
  await rejects(app.api.login(username, 'nope', '1.2.3.4'), 401);
  await rejects(app.api.login('student01', 'temporary-pass', '1.2.3.4'), 401);
  assert.equal([...app.limits.values()].some(n => n >= 1), true);
  assert.equal(app.users.length, 0);
  await rejects((await fixture({ inactive: true })).api.login(username, 'temporary-pass', '1.2.3.4'), 401);
  await rejects((await fixture({ noMembership: true })).api.login(username, 'temporary-pass', '1.2.3.4'), 403);
});

test('20번 넘게 틀리면 15분 잠금 (모아허브와 같은 login_limits 테이블)', async () => {
  const app = await fixture();
  for (let i = 0; i < 20; i += 1) await rejects(app.api.login(username, 'nope', '1.2.3.4'), 401);
  await rejects(app.api.login(username, 'temporary-pass', '1.2.3.4'), 429);
});

test('이미 같은 아이디의 모아랩 계정이 있으면 연결하지 않는다', async () => {
  const app = await fixture({ users: [{ id: 1, username, school_account_id: null, role: 'student' }] });
  await rejects(app.api.login(username, 'temporary-pass', '1.2.3.4'), 409);
});

test('비밀번호 변경은 중앙 계정에 적용되고 모아허브 학생 세션을 끝낸다', async () => {
  const app = await fixture();
  const user = await app.api.login(username, 'temporary-pass', '1.2.3.4');
  await rejects(app.api.changePassword(user, 'nope', 'new-password-1'), 400);
  await rejects(app.api.changePassword(user, 'temporary-pass', 'short'), 400);
  await app.api.changePassword(user, 'temporary-pass', 'new-password-1');
  assert.equal(await passwordMatches('new-password-1', app.accounts[0].password_hash), true);
  assert.equal(app.accounts[0].must_change_password, false);
  assert.equal(app.hubSessions.length, 0);
  assert.equal(app.users[0].must_change_password, false);
  const again = await app.api.login(username, 'new-password-1', '1.2.3.4');
  assert.equal(again.must_change_password, false);
});

test('진로기록 학생 번호는 계정의 career_student_id 이고 비활성 계정은 null', async () => {
  const app = await fixture();
  const user = await app.api.login(username, 'temporary-pass', '1.2.3.4');
  assert.equal(await app.api.careerStudentId(user), careerId);
  assert.equal(await app.api.careerStudentId({ id: 5, school_account_id: null }), null);
  app.accounts[0].active = false;
  assert.equal(await app.api.careerStudentId(user), null);
});
