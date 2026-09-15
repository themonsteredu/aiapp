'use strict';

// 진로업체 담당자(partner) 계정이 학생 기록 화면 밖으로 나가지 못하는지 확인한다.
// 권한은 두 겹이다: (1) 역할 서열이 강사보다 낮아 minRole 'instructor' 경로가 막히고,
// (2) 디스패처의 PARTNER_ALLOW 화이트리스트가 학생용 경로까지 좁힌다.
const test = require('node:test');
const assert = require('node:assert/strict');
// lib/api.js 는 lib/db.js 를 통해 DATABASE_URL 을 요구한다. 연결은 질의할 때 열리므로 더미 값이면 충분하다.
process.env.DATABASE_URL ||= 'postgresql://u:p@127.0.0.1:5432/none';
const { ROLE_LEVEL, roleLevel } = require('../lib/auth');
const { PARTNER_ALLOW } = require('../lib/api');

const allowed = path => PARTNER_ALLOW.some(re => re.test(path));
const SCHOOL = '11111111-2222-4333-8444-555555555555';
const STUDENT = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const PHOTO = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';

test('진로업체 담당자는 강사보다 낮고 학생보다 높다', () => {
  assert.ok(roleLevel('partner') < roleLevel('instructor'), '강사용 API가 열리면 안 된다');
  assert.ok(roleLevel('partner') > roleLevel('student'));
  assert.equal(roleLevel('알수없는역할'), -1);
  assert.deepEqual(Object.keys(ROLE_LEVEL).sort(), ['admin', 'instructor', 'partner', 'student', 'superadmin'].sort());
});

test('진로업체 담당자에게 열린 경로는 기록 화면과 내 계정뿐이다', () => {
  for (const path of [
    '/api/login', '/api/logout', '/api/me', '/api/password', '/api/settings',
    '/api/school-accounts/record-schools',
    `/api/school-accounts/schools/${SCHOOL}/record-students`,
    `/api/school-accounts/schools/${SCHOOL}/students/${STUDENT}/records`,
    `/api/school-accounts/schools/${SCHOOL}/students/${STUDENT}/records/${PHOTO}/history`,
    `/api/school-accounts/schools/${SCHOOL}/students/${STUDENT}/records/${PHOTO}/revise`,
    `/api/career-photos/${PHOTO}`,
  ]) assert.ok(allowed(path), `열려 있어야 한다: ${path}`);
});

test('수업 자료·계정 발급·운영 경로는 진로업체 담당자에게 막힌다', () => {
  for (const path of [
    '/api/decks', '/api/decks/12', '/api/assets/5', '/api/webapp/3', '/api/schedules',
    '/api/users', '/api/class-sessions', '/api/dashboard', '/api/logs', '/api/report',
    '/api/projects', '/api/courses', '/api/gate-token/1', '/api/career-log/records',
    '/api/school-accounts/schools',
    `/api/school-accounts/schools/${SCHOOL}/students`,
    `/api/school-accounts/schools/${SCHOOL}/students/${STUDENT}/reset`,
    `/api/school-accounts/schools/${SCHOOL}/record-access`,
    `/api/school-accounts/schools/${SCHOOL}/access`,
    `/api/school-accounts/schools/${SCHOOL}/managers`,
  ]) assert.equal(allowed(path), false, `막혀 있어야 한다: ${path}`);
});

test('학생 계정 발급 경로는 기록 경로와 생김새가 비슷해도 열리지 않는다', () => {
  // /students/<id> 뒤가 records 가 아니면 모두 막힌다.
  assert.equal(allowed(`/api/school-accounts/schools/${SCHOOL}/students/${STUDENT}`), false);
  assert.equal(allowed('/api/career-photos/not-a-uuid'), false);
  assert.equal(allowed('/api/school-accounts/record-schools/extra'), false);
});
