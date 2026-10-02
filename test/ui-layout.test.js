'use strict';

// 실제 서버·실제 PostgreSQL 로 돌린 E2E 화면 확인(헤드리스 크롬 1280×900 · 390×844)에서 나온 화면 결함의 회귀 확인.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
const style = read('style.css');
const schoolCss = read('school-accounts.css');
const careerCss = read('career-log.css');

test('hidden 속성을 단 버튼은 숨는다 (.btn 의 display 가 [hidden] 을 이기던 문제)', () => {
  // 내 진로기록의 '기록 더 보기'는 hidden 으로 시작하고 더 불러올 기록이 있을 때만 보인다.
  assert.match(read('career-log-ui.js'), /<button id="career-more" class="btn btn-ghost" hidden>/);
  assert.match(style, /\.btn\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});

test('좁은 화면: 닫힌 사이드바 서랍은 그림자를 화면 왼쪽 가장자리에 비추지 않는다', () => {
  const mobile = style.slice(style.indexOf('@media (max-width: 920px)'));
  const closed = /\n  \.sidebar \{([^}]*)\}/.exec(mobile);
  assert.ok(closed, '좁은 화면의 .sidebar 규칙');
  assert.match(closed[1], /translateX\(-100%\)/);
  assert.equal(/box-shadow/.test(closed[1]), false);
  assert.match(mobile, /\.shell\.side-open \.sidebar \{[^}]*box-shadow: var\(--shadow-lg\)/);
});

test('화면 머리(제목·설명)는 한글 어절 중간에서 줄을 바꾸지 않는다', () => {
  assert.match(style, /\.page-head \{[^}]*word-break: keep-all/);
});

test('기록 추가·정정 폼: 문장 칸은 고정폭 글꼴이 아니고, 웹앱 칸 안내 때문에 칸이 어긋나지 않는다', () => {
  assert.match(schoolCss, /\.sa-edit \.sa-roster \{ font-family: inherit;/);
  assert.match(schoolCss, /#rs-add-form \.form-grid \{ align-items: start; \}/);
  // 좁은 화면에서 한 줄을 다 차지하는 단추는 글자를 가운데에 둔다.
  assert.match(schoolCss, /\.sa-actions > \* \{ flex: 1 1 160px; justify-content: center; \}/);
});

test('기록 카드: 제목 아래 줄들은 붙여 보이고 본문은 그 아래에서 띄운다', () => {
  assert.match(careerCss, /\.career-record-sub \{ color: #5b6c65; margin: 0 0 4px; \}/);
  assert.match(careerCss, /\.career-record dl \{ margin: 12px 0 0; \}/);
});

test('버튼에 마우스를 올려도 브랜드 티일 계열을 벗어나지 않는다 (예전 파란 hover 가 터치 기기에서 남던 문제)', () => {
  const hover = name => (new RegExp(`\\.${name}:hover \\{([^}]*)\\}`).exec(style) || [])[1] || '';
  assert.match(hover('btn-primary'), /var\(--brand-600\), var\(--brand-700\)/);
  assert.match(hover('btn-soft'), /var\(--brand-50\)/);
  for (const name of ['btn-primary', 'btn-soft']) assert.equal(/#[0-9a-f]{3,6}\b/i.test(hover(name)), false, `${name}:hover 는 토큰만 쓴다`);
});
