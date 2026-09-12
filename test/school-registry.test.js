'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSchoolRegistry, ISSUER } = require('../lib/school-registry');
const { passwordMatches } = require('../lib/school-accounts');

const roles = { student: 0, instructor: 1, admin: 2, superadmin: 3 };
const roleLevel = role => roles[role] ?? -1;
const school = crypto.randomUUID();
const admin = { id: 1, role: 'admin' }, instructor = { id: 5, role: 'instructor' }, student = { id: 9, role: 'student' };

// managers · school_access · memberships 를 흉내 내는 아주 작은 DB
function fixture({ managers = [], access = [], members = [] } = {}) {
  const calls = [], accounts = [];
  let inTx = 0;
  async function q(sql, values = []) {
    calls.push({ sql, values });
    if (sql.startsWith('INSERT INTO moakit_accounts.school_access')) { access.push({ school: values[0], issuer: values[1] }); return []; }
    if (sql.startsWith('DELETE FROM moakit_accounts.school_access')) { const i = access.findIndex(a => a.school === values[0] && a.issuer === values[1]); if (i >= 0) access.splice(i, 1); return []; }
    if (sql.includes('FROM moakit_accounts.managers')) return managers.some(m => m.school === values[0] && m.issuer === values[1] && m.teacher === values[2]) ? [{ ok: 1 }] : [];
    if (sql.includes('FROM moakit_accounts.school_access')) return access.some(a => a.school === values[0] && a.issuer === values[1]) ? [{ ok: 1 }] : [];
    if (sql.startsWith('INSERT INTO moakit_accounts.schools')) return [{ id: crypto.randomUUID(), name: values[0] }];
    if (sql.startsWith('INSERT INTO moakit_accounts.managers')) { managers.push({ school: values[0], issuer: values[1], teacher: values[2] }); return []; }
    if (sql.includes('FROM moakit_accounts.memberships WHERE school_id')) return members.map(m => ({ account_id: m.id, class_name: m.class_name }));
    if (sql.startsWith('INSERT INTO moakit_accounts.accounts')) { const id = crypto.randomUUID(); accounts.push({ id, career_student_id: values[0], username: values[1], password_hash: values[2] }); return [{ id }]; }
    if (sql.startsWith('SELECT s.id, s.name')) return [];
    return [];
  }
  const one = async (sql, values) => (await q(sql, values))[0] || null;
  const withTransaction = async work => { inTx += 1; try { return await work({ q, one }); } finally { inTx -= 1; } };
  return { registry: createSchoolRegistry({ withTransaction, roleLevel }), calls, accounts, managers, access };
}
const rejects = (p, status) => assert.rejects(p, e => { assert.equal(e.status, status); return true; });

test('담당자가 아니고 열린 학교도 아니면 목록·발급·초기화 모두 거절하고 아무것도 쓰지 않는다', async () => {
  const f = fixture();
  await rejects(f.registry.list(instructor, school), 403);
  await rejects(f.registry.provision(instructor, school, [{ displayName: '학생', className: '1반' }]), 403);
  await rejects(f.registry.reset(admin, school, crypto.randomUUID()), 403);
  await rejects(f.registry.list(student, school), 403);
  assert.equal(f.calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), false);
});

test('모아허브가 모아랩에 열어 준 학교는 관리자만 담당 지정 없이 관리한다', async () => {
  const f = fixture({ access: [{ school, issuer: ISSUER }] });
  assert.deepEqual(await f.registry.list(admin, school), []);
  await rejects(f.registry.list(instructor, school), 403);
});

test('발급은 학생마다 독립된 UUID·아이디·scrypt1 비밀번호를 만들고 감사 기록을 남긴다', async () => {
  const f = fixture({ managers: [{ school, issuer: ISSUER, teacher: '5' }] });
  const issued = await f.registry.provision(instructor, school, [{ displayName: '김모아', grade: 2, classNumber: 1, studentNumber: 3 }, { displayName: '김모아', grade: 2, classNumber: 1, studentNumber: 4 }]);
  assert.equal(issued.length, 2);
  assert.notEqual(issued[0].username, issued[1].username);
  assert.match(issued[0].username, /^m[a-f0-9]{20}$/);
  assert.equal(issued[0].className, '2학년 1반 3번');
  const students = f.calls.filter(c => c.sql.startsWith('INSERT INTO career_log.students')).map(c => c.values[0]);
  assert.equal(new Set(students).size, 2);
  assert.equal(await passwordMatches(issued[0].temporaryPassword, f.accounts[0].password_hash), true);
  assert.equal(f.calls.filter(c => c.sql.startsWith('INSERT INTO moakit_accounts.audit') && c.values[2] === 'account_issued').length, 2);
  assert.ok(f.calls.some(c => c.sql.includes('pg_advisory_xact_lock')), '같은 학교 명단 잠금');
  assert.ok(f.calls.every(c => !c.values.includes(issued[0].temporaryPassword)), '임시 비밀번호 원문은 DB에 가지 않는다');
});

test('이미 있는 자리(학년·반·번호)는 409, 같은 명단 안의 중복은 400', async () => {
  const f = fixture({ managers: [{ school, issuer: ISSUER, teacher: '5' }], members: [{ id: crypto.randomUUID(), class_name: '2학년 1반 3번' }] });
  await rejects(f.registry.provision(instructor, school, [{ displayName: '다른 학생', grade: 2, classNumber: 1, studentNumber: 3 }]), 409);
  await rejects(f.registry.provision(instructor, school, [{ displayName: 'a', grade: 1, classNumber: 1, studentNumber: 1 }, { displayName: 'b', grade: 1, classNumber: 1, studentNumber: 1 }]), 400);
});

test('학교 등록·담당 지정·모아허브에 열기는 관리자만, 대상 제품을 확인한다', async () => {
  const f = fixture();
  await rejects(f.registry.createSchool(instructor, '모아초'), 403);
  const created = await f.registry.createSchool(admin, '모아초등학교');
  assert.ok(f.managers.some(m => m.school === created.id && m.issuer === ISSUER && m.teacher === '1'));
  await rejects(f.registry.setAccess(instructor, created.id, 'moakit-hub', true), 403);
  await rejects(f.registry.setAccess(admin, created.id, 'moakit-lab', true), 400);
  await rejects(f.registry.setAccess(admin, created.id, 'evil', true), 400);
  await f.registry.setAccess(admin, created.id, 'moakit-hub', true);
  assert.ok(f.access.some(a => a.school === created.id && a.issuer === 'moakit-hub'));
  assert.ok(f.calls.some(c => c.sql.startsWith('INSERT INTO moakit_accounts.audit') && c.values[2] === 'access_opened:moakit-hub' && c.values[1] === 'moakit-lab:1'));
  await f.registry.setAccess(admin, created.id, 'moakit-hub', false);
  assert.equal(f.access.some(a => a.issuer === 'moakit-hub'), false);
  await rejects(f.registry.grantManager(instructor, created.id, '7'), 403);
  await f.registry.grantManager(admin, created.id, '7');
  assert.ok(f.managers.some(m => m.school === created.id && m.teacher === '7'));
});
