'use strict';

// 반 전체 기록의 결석·제외 규칙과 저장 전 확인 문구. 저장한 기록은 지울 수 없으므로(append-only)
// 결석·전학·비활성 학생에게 관찰 기록이 남지 않는지를 여기서 고정한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const file = path.join(__dirname, '..', 'public', 'school-accounts-ui.js');
process.removeAllListeners('warning');
const load = () => import(pathToFileURL(file).href);
const student = (id, number, extra = {}) => ({ id, class_name: `1학년 1반 ${number}번`, display_name: `학생${id}`, grade: 1, classNumber: 1, studentNumber: number, ...extra });

test('비활성 계정은 처음부터 제외되고, 줄에서 고른 결석·제외가 우선한다', async () => {
  const { bulkExcluded } = await load();
  assert.equal(bulkExcluded(student('a', 1), undefined), false);
  assert.equal(bulkExcluded(student('a', 1, { active: true }), {}), false);
  assert.equal(bulkExcluded(student('b', 2, { active: false }), undefined), true, '비활성 계정은 기본 제외');
  assert.equal(bulkExcluded(student('b', 2, { active: false }), { skip: false }), false, '체크를 풀면 저장 대상');
  assert.equal(bulkExcluded(student('a', 1), { skip: true }), true, '결석으로 표시한 학생');
});

test('저장 계획은 결석·제외 학생을 칸이 채워져 있어도 보내지 않는다', async () => {
  const { bulkPlan } = await load();
  const students = [student('a', 1), student('b', 2, { active: false }), student('c', 3), student('d', 4, { active: false })];
  // '공통 내용 채우기' 뒤 모습: 모든 줄에 활동이 들어가 있다.
  const rows = {
    a: { activity: '드론 비행 원리를 배웠다' },
    b: { activity: '드론 비행 원리를 배웠다' },              // 비활성 계정 → 기본 제외
    c: { activity: '드론 비행 원리를 배웠다', skip: true }, // 결석 표시
    d: { activity: '드론 비행 원리를 배웠다', skip: false }, // 비활성이지만 직접 포함
  };
  assert.deepEqual(bulkPlan(students, rows).send.map(s => s.id), ['a', 'd']);
  // 활동 칸이 빈 제외 학생은 '활동을 적어야 한다' 경고 대상도 아니다.
  assert.deepEqual(bulkPlan(students, { c: { activity: '', strengths: '메모', skip: true } }).invalid, []);
  // 실패 후 결석으로 바꾼 학생은 다시 보내지 않는다.
  assert.deepEqual(bulkPlan(students, { a: { activity: 'x', status: 'failed', skip: true } }, { onlyFailed: true }).send, []);
});

test('저장 전 확인 문구에 저장될 학생 수·이름과 제외 수, 지울 수 없다는 안내가 나온다', async () => {
  const { bulkSaveConfirm } = await load();
  const text = bulkSaveConfirm([student('a', 1), student('c', 3), { id: 'x', display_name: '번호없음' }], 2);
  assert.match(text, /^3명의 진로 관찰 기록을 저장합니다\./);
  assert.match(text, /1번 학생a, 3번 학생c, 번호없음/);
  assert.match(text, /결석·제외로 표시한 2명은 저장하지 않습니다/);
  assert.match(text, /지울 수 없고 정정만/);
  assert.equal(/결석·제외/.test(bulkSaveConfirm([student('a', 1)], 0)), false);
});

test('반 전체 기록 화면은 사진을 정정(수정)이 아니라 사진 더하기로 안내하고, 저장 전에 확인을 받는다', () => {
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(/'수정'으로 더/.test(source), false, '사진 때문에 정정본을 만들게 하지 않는다');
  assert.equal(/4\.5MB로 제한/.test(source), false);
  assert.ok(source.includes("'사진 더하기'"));
  assert.ok(source.includes('/records/${id}/photos'), '사진 전용 경로를 쓴다');
  assert.ok(/if \(!confirm\(bulkSaveConfirm\(/.test(source), '저장 전 확인을 취소하면 아무것도 보내지 않는다');
  // 채우기는 버튼이 둘 — '적은 칸도 바꾸기' 확인을 취소하면 아무것도 바꾸지 않는다.
  assert.ok(source.includes('id="rs-bulk-fill"') && source.includes('id="rs-bulk-fill-all"'));
  assert.ok(/if \(overwrite && written\.length && !confirm\([^\n]*\)\) return;/.test(source));
});
