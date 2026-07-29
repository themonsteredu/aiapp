'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classSessionState } = require('../lib/class-session-policy');

const MIN = 60 * 1000;
const NOW = Date.parse('2026-03-10T02:00:00Z');

// 기본: 아직 1시간 남은 유효한 수업
function session(over = {}) {
  return {
    active: true,
    created_at: new Date(NOW - 60 * MIN).toISOString(),
    expires_at: new Date(NOW + 60 * MIN).toISOString(),
    ...over,
  };
}

test('종료 시각 전에는 유효하다', () => {
  assert.deepStrictEqual(classSessionState(session(), NOW), { action: 'ok' });
});

test('종료 1분 전에도 연장하지 않고 그대로 둔다', () => {
  const r = classSessionState(session({ expires_at: new Date(NOW + 1 * MIN).toISOString() }), NOW);
  assert.deepStrictEqual(r, { action: 'ok' });
});

test('종료 시각이 되면 곧바로 끊는다 (유예 없음)', () => {
  const r = classSessionState(session({ expires_at: new Date(NOW).toISOString() }), NOW);
  assert.strictEqual(r.action, 'end');
  assert.match(r.message, /수업 시간이 끝났습니다/);
});

test('종료 1분 후에도 끊긴다', () => {
  const r = classSessionState(session({ expires_at: new Date(NOW - 1 * MIN).toISOString() }), NOW);
  assert.strictEqual(r.action, 'end');
  assert.match(r.message, /수업 시간이 끝났습니다/);
});

test("선생님이 '수업 종료'를 누르면 시간이 남아도 끊는다", () => {
  const r = classSessionState(session({ active: false }), NOW);
  assert.strictEqual(r.action, 'end');
  assert.match(r.message, /선생님이 수업을 종료했습니다/);
});

test('수업 정보가 없으면 종료로 판단한다', () => {
  assert.strictEqual(classSessionState(null, NOW).action, 'end');
});

test('만료 시각이 깨져 있으면 종료로 판단한다', () => {
  const r = classSessionState(session({ expires_at: '알 수 없음' }), NOW);
  assert.strictEqual(r.action, 'end');
});
