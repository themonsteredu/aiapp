'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  classSessionState, CLASS_EXTEND_MINUTES, CLASS_GRACE_MINUTES, CLASS_MAX_HOURS,
} = require('../lib/class-session-policy');

const MIN = 60 * 1000;
const NOW = Date.parse('2026-03-10T02:00:00Z');

// 기본: 1시간 전에 만든, 아직 유효한 수업
function session(over = {}) {
  return {
    active: true,
    created_at: new Date(NOW - 60 * MIN).toISOString(),
    expires_at: new Date(NOW + 60 * MIN).toISOString(),
    ...over,
  };
}

test('여유가 충분하면 아무것도 하지 않는다', () => {
  assert.deepStrictEqual(classSessionState(session(), NOW), { action: 'ok' });
});

test('수업이 곧 끝나는데 학생이 쓰고 있으면 만료를 미룬다', () => {
  const r = classSessionState(session({ expires_at: new Date(NOW + 5 * MIN).toISOString() }), NOW);
  assert.strictEqual(r.action, 'extend');
  assert.strictEqual(r.until.getTime(), NOW + CLASS_EXTEND_MINUTES * MIN);
});

test('만료 직후 유예 시간 안이면 되살린다 (쉬는 시간에 손 뗀 학생)', () => {
  const r = classSessionState(session({ expires_at: new Date(NOW - 10 * MIN).toISOString() }), NOW);
  assert.strictEqual(r.action, 'extend');
});

test('유예 시간까지 지나면 종료한다', () => {
  const r = classSessionState(
    session({ expires_at: new Date(NOW - (CLASS_GRACE_MINUTES + 1) * MIN).toISOString() }), NOW);
  assert.strictEqual(r.action, 'end');
  assert.match(r.message, /수업 시간이 끝났습니다/);
});

test("선생님이 '수업 종료'를 누르면 유예 없이 즉시 끊는다", () => {
  const r = classSessionState(session({ active: false }), NOW);
  assert.strictEqual(r.action, 'end');
  assert.match(r.message, /선생님이 수업을 종료했습니다/);
});

test('총 수명 상한을 넘기면 더 연장하지 않는다', () => {
  const r = classSessionState(session({
    created_at: new Date(NOW - (CLASS_MAX_HOURS + 1) * 60 * MIN).toISOString(),
    expires_at: new Date(NOW + 5 * MIN).toISOString(),
  }), NOW);
  assert.strictEqual(r.action, 'end');
  assert.match(r.message, /사용 기한이 끝났습니다/);
});

test('연장은 총 수명 상한을 넘지 않는다', () => {
  // 상한까지 20분 남은 시점 — 60분이 아니라 20분만 늘어나야 한다
  const created = NOW - (CLASS_MAX_HOURS * 60 - 20) * MIN;
  const r = classSessionState(session({
    created_at: new Date(created).toISOString(),
    expires_at: new Date(NOW + 5 * MIN).toISOString(),
  }), NOW);
  assert.strictEqual(r.action, 'extend');
  assert.strictEqual(r.until.getTime(), created + CLASS_MAX_HOURS * 60 * MIN);
  assert.ok(r.until.getTime() < NOW + CLASS_EXTEND_MINUTES * MIN);
});

test('이미 충분히 연장돼 있으면 다시 쓰지 않는다', () => {
  // 상한에 딱 걸려 더 늘릴 수 없지만 아직 만료 전인 상태
  const created = NOW - (CLASS_MAX_HOURS * 60 - 10) * MIN;
  const r = classSessionState(session({
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + CLASS_MAX_HOURS * 60 * MIN).toISOString(),
  }), NOW);
  assert.deepStrictEqual(r, { action: 'ok' });
});

test('수업 정보가 없으면 종료로 판단한다', () => {
  assert.strictEqual(classSessionState(null, NOW).action, 'end');
});

test('만료 시각이 깨져 있으면 종료로 판단한다', () => {
  const r = classSessionState(session({ expires_at: '알 수 없음' }), NOW);
  assert.strictEqual(r.action, 'end');
});
