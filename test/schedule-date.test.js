'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dateInTimezone } = require('../lib/timezone');

test('DB DATE 문자열은 YYYY-MM-DD 그대로 유지한다', () => {
  assert.equal(dateInTimezone('2026-07-25'), '2026-07-25');
});

test('UTC 시각은 한국시간 날짜로 변환한다', () => {
  assert.equal(dateInTimezone(new Date('2026-07-24T15:00:00.000Z')), '2026-07-25');
  assert.equal(dateInTimezone('2026-07-24T15:00:00.000Z'), '2026-07-25');
});

test('잘못된 날짜는 빈 값으로 처리한다', () => {
  assert.equal(dateInTimezone('날짜 아님'), '');
});
