'use strict';

// 학생 기록 화면의 '반 전체 기록' 규칙. 행 상태 표시·확인 창·좁은 화면 배치는 헤드리스 크롬과 가짜 API 로 따로 확인했다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const file = path.join(__dirname, '..', 'public', 'school-accounts-ui.js');
// 브라우저용 ES 모듈을 그대로 불러온다. 형식 자동 감지 경고는 테스트 출력에서 뺀다.
process.removeAllListeners('warning');
const load = () => import(pathToFileURL(file).href);

const student = (id, className, extra = {}) => {
  const m = /^(\d+)학년 (\d+)반 (\d+)번$/.exec(className);
  return { id, class_name: className, display_name: `학생${id}`, grade: m ? Number(m[1]) : null, classNumber: m ? Number(m[2]) : null, studentNumber: m ? Number(m[3]) : null, ...extra };
};

test('학년·반 묶음: 학년·반 순으로, 소속을 읽을 수 없는 학생은 맨 뒤 기타로 모은다', async () => {
  const { classGroups, classKeyOf } = await load();
  const students = [student('a', '2학년 1반 1번'), student('b', '방과후 A반'), student('c', '1학년 10반 3번'), student('d', '1학년 2반 1번'), student('e', '2학년 1반 2번')];
  assert.equal(classKeyOf(students[0]), '2-1');
  assert.equal(classKeyOf(students[1]), 'other');
  assert.deepEqual(classGroups(students), [
    { key: '1-2', count: 1, label: '1학년 2반' },
    { key: '1-10', count: 1, label: '1학년 10반' },
    { key: '2-1', count: 2, label: '2학년 1반' },
    { key: 'other', count: 1, label: '기타' },
  ]);
  assert.deepEqual(classGroups([]), []);
});

test('저장 계획: 빈 줄과 이미 저장된 줄은 건너뛰고, 활동 칸이 빈 줄은 보내지 않는다', async () => {
  const { bulkPlan } = await load();
  const students = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => student(id, `1학년 1반 ${id.charCodeAt(0) - 96}번`));
  const rows = {
    a: { activity: '모둠 발표를 이끌었다', strengths: '', next_step: '' },
    b: { activity: '   ', strengths: '', next_step: '' },                    // 공백뿐 → 빈 줄
    c: { activity: '', strengths: '그림 설명을 잘함', next_step: '' },      // 활동 칸 없음 → 막힘
    d: { activity: '저장된 학생', status: 'saved' },
    e: { activity: '응답만 잃은 학생', status: 'duplicate' },
    // f: 줄 자체가 없음
  };
  const plan = bulkPlan(students, rows);
  assert.deepEqual(plan.send.map(s => s.id), ['a']);
  assert.deepEqual(plan.invalid.map(s => s.id), ['c']);
});

test('실패한 학생만 다시 저장: 실패한 줄만 고르고, 저장된 줄은 다시 보내지 않는다', async () => {
  const { bulkPlan } = await load();
  const students = ['a', 'b', 'c'].map(id => student(id, '3학년 2반 1번'));
  const rows = {
    a: { activity: '실패', status: 'failed', attempt: '11111111-1111-4111-8111-111111111111' },
    b: { activity: '아직 안 보냄', status: '' },
    c: { activity: '성공', status: 'saved' },
  };
  assert.deepEqual(bulkPlan(students, rows, { onlyFailed: true }).send.map(s => s.id), ['a']);
  assert.deepEqual(bulkPlan(students, rows).send.map(s => s.id), ['a', 'b']);
});

test('요청 본문: 진로 관찰 기록, 줄마다의 시도 번호, 사진 없음, 웹앱은 관리자만', async () => {
  const { bulkPayload } = await load();
  const common = { title: '항공 진로 체험 2회차', date: '2026-10-02', deckId: '7' };
  const row = { activity: '드론 경로를 설계했다', strengths: '공간 감각', next_step: '', attempt: '22222222-2222-4222-8222-222222222222', status: 'failed', message: 'x' };
  const payload = bulkPayload(common, row, { linkDeck: true });
  assert.deepEqual(payload, {
    kind: 'career_observation', title: '항공 진로 체험 2회차', occurred_at: '2026-10-02', attempt_id: row.attempt,
    activity: '드론 경로를 설계했다', strengths: '공간 감각', next_step: '', deck_id: 7,
  });
  assert.equal('photos' in payload, false);
  // 서버는 deck_id 를 정수로만 받는다 (문자열 '7' 은 400).
  assert.equal(typeof payload.deck_id, 'number');
  // 같은 줄을 다시 보내도 시도 번호가 같다 — 서버가 한 번만 남긴다.
  assert.equal(bulkPayload(common, row).attempt_id, payload.attempt_id);
  // 강사·진로업체 담당자(linkDeck 없음)는 반 전체 기록에서 웹앱을 보내지 않는다 — 서버도 관리자만 아무 웹앱이나 잇게 한다.
  assert.equal('deck_id' in bulkPayload(common, row), false);
  assert.equal('deck_id' in bulkPayload({ ...common, deckId: '' }, row, { linkDeck: true }), false);
  assert.equal(bulkPayload({ ...common, date: '' }, row).occurred_at, undefined);
});

test('반 전체 기록은 기존 기록 추가 API 만 쓴다 (새 API 없음 → 진로업체 허용 목록 그대로)', () => {
  const source = fs.readFileSync(file, 'utf8');
  const urls = [...source.matchAll(/api\('POST', `([^`]+)`/g)].map(m => m[1]);
  assert.ok(urls.includes('/api/school-accounts/schools/${school}/students/${s.id}/records'));
  assert.equal(urls.some(url => /bulk|batch/i.test(url)), false);
  const registry = fs.readFileSync(path.join(__dirname, '..', 'lib', 'school-registry-api.js'), 'utf8');
  assert.equal(/bulk|batch/i.test(registry), false);
});
