'use strict';

// 반 전체 기록·학생별 기록 저장의 실패 가려내기, '이미 저장됨 · 내용이 다름' 줄, 탭을 새로 고쳐도 남는 작성 내용.
// 저장 실패는 public/app.js 의 api() 가 실제로 던지는 모양으로 확인한다 — api() 가 바뀌면 여기서 먼저 깨진다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const file = path.join(__dirname, '..', 'public', 'school-accounts-ui.js');
process.removeAllListeners('warning');
const load = () => import(pathToFileURL(file).href);
const source = fs.readFileSync(file, 'utf8');

// public/app.js 의 api() 를 그대로 떼어 가짜 fetch 와 state 위에서 돌린다.
function realApi() {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const start = app.indexOf('async function api(method, url, body) {');
  assert.ok(start >= 0, 'public/app.js 에 api() 가 있어야 한다');
  const end = app.indexOf('\n}\n', start);
  const context = vm.createContext({ state: { me: { id: 3, role: 'admin' }, access: { allowed: true }, mustAgree: false }, location: { hash: '#/student-records' },
    renderBlocked() {}, afterLoginHash: null, fetch: null, Error, JSON });
  vm.runInContext(`${app.slice(start, end + 2)}\nglobalThis.api = api;`, context);
  // reply: { status, body } 또는 'network'
  return async reply => {
    context.state.me = { id: 3, role: 'admin' }; context.state.mustAgree = false;
    const accessBefore = context.state.access;
    context.fetch = async () => {
      if (reply === 'network') throw new TypeError('Failed to fetch');
      return { ok: reply.status < 400, status: reply.status, json: async () => { if (reply.body === undefined) throw new SyntaxError('not json'); return reply.body; } };
    };
    try { await context.api('POST', '/api/school-accounts/schools/x/students/y/records', { a: 1 }); return null; }
    catch (err) { return { err, after: { signedIn: !!context.state.me, mustAgree: !!context.state.mustAgree, accessChanged: context.state.access !== accessBefore } }; }
  };
}

test('저장 실패 가려내기: 서버가 거절한 4xx는 저장 안 됨, 5xx는 결과 모름, 로그인·이용 시간·동의는 멈춤, 연결 끊김만 결과 모름', async () => {
  const { classifySaveError, SAVE_UNKNOWN } = await load();
  const call = realApi();
  const kind = async reply => { const r = await call(reply); return classifySaveError(r.err, r.after); };

  const rejected = await kind({ status: 400, body: { error: '제목과 활동 모습을 확인해 주세요.' } });
  assert.deepEqual(rejected, { kind: 'rejected', message: '제목과 활동 모습을 확인해 주세요.' });
  assert.equal((await kind({ status: 403, body: { error: '기록 수정 권한이 없습니다.' } })).kind, 'rejected');
  // 5xx(게이트웨이·시간 초과 포함)는 저장을 마친 뒤 실패했을 수도 있다 — 결과 모름으로 두고 같은 내용으로 다시 보내게 한다.
  const gateway = await kind({ status: 502 });
  assert.equal(gateway.kind, 'unknown');
  assert.equal((await kind({ status: 500, body: { error: '서버 오류' } })).kind, 'unknown');

  const login = await kind({ status: 401, body: { error: '로그인이 필요합니다.' } });
  assert.deepEqual([login.kind, login.reason], ['stop', 'login']);
  const blocked = await kind({ status: 403, body: { error: 'time_blocked', message: '지금은 접근 시간이 아닙니다.', access: { allowed: false } } });
  assert.deepEqual([blocked.kind, blocked.reason], ['stop', 'time_blocked']);
  const agreement = await kind({ status: 403, body: { error: 'agreement_required', message: '동의가 필요합니다.' } });
  assert.deepEqual([agreement.kind, agreement.reason], ['stop', 'agreement']);

  const unknown = await kind('network');
  assert.deepEqual(unknown, { kind: 'unknown', message: SAVE_UNKNOWN });
  assert.match(unknown.message, /한 번만 남습니다/);
});

test('같은 시도 번호에 다른 내용이 이미 저장된 409 는 conflict — 저장 안 됨도, 다시 보낼 대상도 아니다', async () => {
  const { classifySaveError, bulkRowStatusFor, bulkRowSettled, bulkRowRetry, bulkPlan } = await load();
  const call = realApi();
  const r = await call({ status: 409, body: { error: '이 저장 요청은 이미 다른 내용으로 저장되었습니다.', code: 'attempt_conflict' } });
  const failure = classifySaveError(r.err, r.after);
  assert.equal(failure.kind, 'conflict');
  assert.equal(bulkRowStatusFor(failure), 'conflict');
  // code 없는 409(예: 이미 정정된 기록)는 conflict 가 아니다.
  const plain = await call({ status: 409, body: { error: '이미 정정된 기록입니다.' } });
  assert.equal(classifySaveError(plain.err, plain.after).kind, 'rejected');

  const row = { activity: '저장된 것과 다르게 고친 내용', status: 'conflict', attempt: '33333333-3333-4333-8333-333333333333' };
  assert.equal(bulkRowSettled(row), true, '서버에 기록이 있다 — 칸을 잠그고 기록 보기를 준다');
  assert.equal(bulkRowRetry(row), false);
  const students = [{ id: 'a', display_name: '가' }, { id: 'b', display_name: '나' }, { id: 'c', display_name: '다' }];
  const rows = { a: row, b: { activity: '연결 끊김', status: 'unknown', attempt: '44444444-4444-4444-8444-444444444444' }, c: { activity: '거절됨', status: 'failed' } };
  assert.deepEqual(bulkPlan(students, rows).send.map(s => s.id), ['b', 'c'], 'conflict 줄은 다시 보내지 않는다');
  assert.deepEqual(bulkPlan(students, rows, { onlyFailed: true }).send.map(s => s.id), ['b', 'c'], '결과를 모르는 줄도 같은 시도 번호로 다시 보낸다');
});

test('저장 확인 필요(unknown) 줄이 있으면 제목·날짜·웹앱을 고정한다 — 바꾼 채 다시 보내면 저장된 학생이 모두 409 가 된다', async () => {
  const { bulkSharedLocked } = await load();
  const students = [{ id: 'a' }, { id: 'b' }];
  const attempt = '55555555-5555-4555-8555-555555555555';
  assert.equal(bulkSharedLocked(students, {}), false);
  assert.equal(bulkSharedLocked(students, { a: { activity: '아직 안 보냄', status: '' }, b: { activity: '거절됨', status: 'failed' } }), false,
    '서버가 거절한 줄만 있으면 서버에 기록이 없다 — 공통 칸을 고쳐도 된다');
  // 와이파이가 끊겨 모든 줄이 결과를 모르는 채 끝난 경우.
  assert.equal(bulkSharedLocked(students, { a: { activity: '보냄', status: 'unknown', attempt }, b: { activity: '보냄', status: 'unknown', attempt } }), true);
  assert.equal(bulkSharedLocked(students, { a: { activity: '저장됨', status: 'saved' } }), true);
  assert.equal(bulkSharedLocked(students, { a: { activity: '내용 다름', status: 'conflict' } }), true);
  // 다른 반 학생 줄은 세지 않는다.
  assert.equal(bulkSharedLocked([{ id: 'b' }], { a: { activity: '보냄', status: 'unknown', attempt } }), false);
  // 화면의 고정 판단이 이 규칙을 쓴다.
  assert.match(source, /const bulkLocked = \(\) => !!RS\.bulk && bulkSharedLocked\(bulkStudents\(\), RS\.bulk\.rows\);/);
});

test('저장을 마친 뒤 요약: 저장·내용 다름·저장 안 됨·확인 필요·멈춤을 나눠 알린다', async () => {
  const { bulkRunSummary } = await load();
  const ok = bulkRunSummary([{ status: 'saved' }, { status: 'duplicate' }]);
  assert.equal(ok.err, false);
  assert.match(ok.text, /^2명 저장했습니다\./);
  const mixed = bulkRunSummary([{ status: 'saved' }, { status: 'conflict' }, { status: 'failed' }, { status: 'unknown' }]);
  assert.equal(mixed.err, true);
  assert.match(mixed.text, /1명 저장, 1명 이미 다른 내용으로 저장됨, 1명 저장 안 됨, 1명 저장 확인 필요/);
  assert.match(mixed.text, /학생별 보기에서/);
  const halted = bulkRunSummary([{ status: 'saved' }, { status: '' }, { status: '' }], { kind: 'stop', reason: 'login', message: '로그인이 끝나 저장하지 못했습니다.' });
  assert.match(halted.text, /1명 저장, 2명 보내지 않음\. 로그인이 끝나 저장하지 못했습니다\. 적은 내용은 이 탭에 남아 있습니다\./);
  assert.match(halted.short, /^저장을 멈췄습니다\./);
});

test('반 전체 저장은 로그인 만료·이용 시간·동의 필요에서 멈추고, 그 밖의 실패는 다음 학생으로 넘어간다', () => {
  const run = source.slice(source.indexOf('async function runBulk('), source.indexOf('function renderRecords('));
  assert.match(run, /const accessBefore = state\.access;\s+try \{/);
  assert.match(run, /if \(failure\.kind === 'stop'\) \{ row\.status = ''; row\.message = ''; halt = failure; \}/);
  assert.match(run, /if \(halt\) break;/);
  // 멈춘 뒤 보내지 않은 학생은 '저장 대기'로 남기지 않는다.
  assert.match(run, /if \(B\.rows\[s\.id\]\.status === 'queued'\) B\.rows\[s\.id\]\.status = '';/);
  // 이용 시간 안내·로그인 화면을 다시 덮지 않는다.
  assert.match(run, /if \(halt \|\| location\.hash !== RP \|\| RS\.bulk !== B\) return;/);
});

test('작성 내용 보관: 같은 계정·학교의 것만 되살리고, 저장 중이던 줄은 확인 필요, 대기 줄은 빈 상태로', async () => {
  const { bulkSnapshot, bulkRestore, bulkDraftKey, SAVE_UNKNOWN } = await load();
  const school = '11111111-2222-4333-8444-555555555555';
  const attempt = '22222222-2222-4222-8222-222222222222';
  const bulk = { owner: 7, schoolId: school, classKey: '2-1', title: '항공 진로 체험', date: '2026-10-02', deckId: '12', deckTitle: '항공 관제', common: '드론 비행',
    running: true, announce: true, summary: null,
    rows: {
      a: { activity: '저장 중이었다', strengths: '', next_step: '', attempt, status: 'saving', message: '' },
      b: { activity: '대기 중이었다', strengths: '침착함', next_step: '', attempt: '33333333-3333-4333-8333-333333333333', status: 'queued', message: '' },
      c: { activity: '저장됨', strengths: '', next_step: '', attempt: '44444444-4444-4444-8444-444444444444', status: 'saved', message: '', recordId: 'r1' },
      d: { activity: '', strengths: '', next_step: '', attempt: '', status: '', message: '', skip: true },
      e: { activity: '다른 내용', strengths: '', next_step: '', attempt: '55555555-5555-4555-8555-555555555555', status: 'conflict', message: '' },
    } };
  const raw = JSON.stringify(bulkSnapshot(bulk, true));
  assert.equal(raw.includes('"running"'), false, '실행 중 표시는 남기지 않는다');
  const restored = bulkRestore(raw, { owner: 7, schoolId: school });
  assert.equal(restored.open, true);
  assert.equal(restored.bulk.running, false);
  assert.deepEqual([restored.bulk.title, restored.bulk.date, restored.bulk.deckId, restored.bulk.common, restored.bulk.classKey], ['항공 진로 체험', '2026-10-02', '12', '드론 비행', '2-1']);
  assert.deepEqual(Object.fromEntries(Object.entries(restored.bulk.rows).map(([id, row]) => [id, row.status])), { a: 'unknown', b: '', c: 'saved', d: '', e: 'conflict' });
  assert.equal(restored.bulk.rows.a.attempt, attempt, '시도 번호를 지켜야 다시 보내도 한 번만 남는다');
  assert.equal(restored.bulk.rows.a.message, SAVE_UNKNOWN);
  assert.equal(restored.bulk.rows.b.strengths, '침착함');
  assert.equal(restored.bulk.rows.d.skip, true);
  // 다른 계정·다른 학교·망가진 값은 되살리지 않는다.
  assert.equal(bulkRestore(raw, { owner: 8, schoolId: school }), null);
  assert.equal(bulkRestore(raw, { owner: 7, schoolId: '99999999-2222-4333-8444-555555555555' }), null);
  assert.equal(bulkRestore('{not json', { owner: 7, schoolId: school }), null);
  assert.equal(bulkRestore(JSON.stringify({ v: 2 }), { owner: 7, schoolId: school }), null);
  const tampered = JSON.parse(raw);
  tampered.rows.a.attempt = 'not-a-uuid'; tampered.rows.a.status = 'hacked'; tampered.deckId = '1; drop'; tampered.classKey = '<b>';
  const clean = bulkRestore(tampered, { owner: 7, schoolId: school }).bulk;
  assert.deepEqual([clean.rows.a.attempt, clean.rows.a.status, clean.deckId, clean.classKey], ['', '', '', '']);
  // 계정·학교마다 따로 둔다.
  assert.notEqual(bulkDraftKey(7, school), bulkDraftKey(8, school));
});

test('작성 내용은 sessionStorage 에만, 모든 접근은 try/catch 로 감싼다 (공용 기기에서 localStorage 금지)', () => {
  assert.equal(/localStorage\s*[.[]/.test(source), false, 'localStorage 를 읽거나 쓰지 않는다');
  assert.match(source, /window\.sessionStorage/);
  const store = source.slice(source.indexOf('function draftStore()'));
  for (const name of ['draftStore', 'readBulkDraft', 'writeBulkDraft', 'clearBulkDraft', 'sweepBulkDrafts']) {
    const body = store.slice(store.indexOf(`function ${name}(`), store.indexOf('\n}\n', store.indexOf(`function ${name}(`)));
    assert.match(body, /try \{/, `${name} 은 try 로 감싼다`);
  }
  // 닫기·학교 바꾸기는 남긴 내용을 지우고, 다른 계정의 것은 열 때 지운다.
  assert.match(source, /function dropBulk\(\) \{\s+if \(RS\.bulk\) clearBulkDraft\(RS\.bulk\.owner, RS\.bulk\.schoolId\);/);
  assert.match(source, /\$\('rs-bulk-close'\)\.onclick = \(\) => \{\s+if \(!confirmDropBulk\('닫으면'\)\) return;\s+dropBulk\(\);/);
  assert.match(source, /if \(!confirmDropBulk\('학교를 바꾸면'\) \|\| !confirmDropForm\(\)\) \{ schoolSel\.value = RS\.schoolId; return; \}\s+dropBulk\(\);/);
  assert.match(source, /const drafts = sweepBulkDrafts\(state\.me\.id\)/);
  // 다 저장하면(남길 것이 없으면) 지운다.
  assert.match(source, /if \(keep\) writeBulkDraft\(B\.owner, B\.schoolId, bulkSnapshot\(B, RS\.bulkOpen\)\);\s+else clearBulkDraft\(B\.owner, B\.schoolId\);/);
});

test('웹앱 목록(GET /api/decks)은 관리자만 부르고, 반 전체 기록의 웹앱 칸도 관리자만 본다', () => {
  assert.match(source, /const canListDecks = \(\) => !!state\.me && level\(state\.me\.role\) >= 2;/);
  assert.match(source, /function loadDeckList\(force = false\) \{\s+if \(!canListDecks\(\)\) return;/);
  assert.match(source, /const linkDeck = canListDecks\(\);\s+const deckField = linkDeck \?/);
  assert.match(source, /const school = RS\.schoolId, linkDeck = canListDecks\(\);/);
  // 불러오는 중·실패를 칸 아래에 알리고 다시 불러오기 단추를 준다 — 조용히 '연결 안 함'만 두지 않는다.
  assert.ok(source.includes("'웹앱 목록을 불러오는 중…'"));
  assert.ok(source.includes('data-rs-deck-retry'));
  assert.match(source, /\.catch\(\(\) => \{ if \(RS\.deckListFor === me\) RS\.deckError = true; \}\)/);
});

test('반 전체 기록을 여는 동안 학생 찾기용 학년·반 칸은 숨기고, 두 칸의 이름을 다르게 둔다', () => {
  assert.match(source, /\$\{bulkView \? '' : `<div><label for="rs-class-filter">학생 찾기 · 학년·반<\/label>/);
  assert.match(source, /<label for="rs-bulk-class">기록할 반<\/label>/);
});

test('쓰던 폼이 있을 때 다른 폼·반 전체 기록을 열면 먼저 확인을 받는다', () => {
  const observe = source.slice(source.indexOf("document.querySelectorAll('[data-rs-observe]')"), source.indexOf('const addForm ='));
  assert.match(observe, /if \(!r \|\| !confirmDropForm\(\)\) return;/);
  const bulkOpen = source.slice(source.indexOf('if (bulkOpen) bulkOpen.onclick'), source.indexOf('bindBulk();\n'));
  assert.match(bulkOpen, /if \(!confirmDropForm\(\)\) return;/);
  assert.match(source, /function formDraftDirty\(\) \{\s+if \(RS\.newPhotos\.length\) return true;/);
});

test('저장을 마치면 요약 줄로 초점을 옮기고, 화면에 먼저 그려 둔 live region 에 글자를 넣는다', () => {
  assert.match(source, /<p class="msg rs-bulk-summary[^"]*" id="rs-bulk-summary" tabindex="-1" role="status" aria-live="polite">/);
  const announce = source.slice(source.indexOf('function announceBulkSummary('), source.indexOf('async function runBulk('));
  assert.ok(announce.indexOf('target.focus()') < announce.indexOf('setTimeout('), '초점을 먼저 옮기고 나서 글자를 넣는다');
  assert.match(announce, /el\.textContent = B\.summary\.text;/);
  // 막 끝난 직후의 다시 그리기는 요약 줄을 비워 둔다 (글자가 바뀌어야 읽힌다).
  assert.match(source, /const summary = B\.summary && !B\.announce \? B\.summary : null;/);
  assert.match(source, /B\.announce = true;\s+renderRecords\(\);\s+announceBulkSummary\(B\);/);
});
