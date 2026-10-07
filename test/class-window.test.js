'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classWindow, localToDate, formatLocal, formatRange, MAX_DAYS } = require('../lib/class-window');

const NOW = new Date('2026-10-07T03:00:00.000Z'); // 한국시간 10월 7일(수) 12:00

test('화면의 한국시간 입력을 실제 시각으로 읽는다', () => {
  assert.equal(localToDate('2026-10-08T10:00').toISOString(), '2026-10-08T01:00:00.000Z');
  assert.equal(localToDate('2026-10-08T00:30').toISOString(), '2026-10-07T15:30:00.000Z');
  assert.equal(localToDate('2026-10-08T10:00:30').toISOString(), '2026-10-08T01:00:30.000Z');
});

test('형식이 틀리거나 달력에 없는 날짜는 거른다', () => {
  for (const bad of ['', null, undefined, '2026-02-30T10:00', '2026-10-08 10:00', '2026-10-08T24:00', '2026-10-08T10:60', '2026-13-01T10:00', '내일 10시', '2026-10-08T10:00Z']) {
    assert.equal(localToDate(bad), null, String(bad));
  }
});

test('내일 수업 코드를 오늘 미리 발급할 수 있다', () => {
  const r = classWindow('2026-10-08T10:00', '2026-10-08T12:00', NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.minutes, 120);
  assert.equal(formatRange(r.start, r.end), '10월 8일(목) 10:00 ~ 12:00');
});

test('시작이 조금 지난 수업도 바로 열 수 있다', () => {
  assert.equal(classWindow('2026-10-07T11:55', '2026-10-07T13:55', NOW).error, undefined);
});

test('잘못된 입장 시간은 이유를 알려 준다', () => {
  assert.match(classWindow('2026-10-08T12:00', '2026-10-08T10:00', NOW).error, /마감 시각은 시작 시각보다/);
  assert.match(classWindow('2026-10-08T10:00', '2026-10-08T10:05', NOW).error, /10분 이상/);
  assert.match(classWindow('2026-10-01T10:00', '2026-10-07T11:00', NOW).error, /이미 지났습니다/);
  assert.match(classWindow('2026-10-08T10:00', `2026-10-${String(8 + MAX_DAYS + 1).padStart(2, '0')}T10:00`, NOW).error, /최대 7일/);
  assert.match(classWindow('2027-03-01T10:00', '2027-03-01T12:00', NOW).error, /90일 안으로/);
  assert.match(classWindow('2026-10-08T10:00', '', NOW).error, /모두 입력/);
});

test('날이 바뀌는 수업은 마감에도 날짜를 붙인다', () => {
  assert.equal(formatLocal(new Date('2026-10-08T01:00:00Z')), '10월 8일(목) 10:00');
  assert.equal(formatRange(localToDate('2026-10-08T22:00'), localToDate('2026-10-09T01:00')), '10월 8일(목) 22:00 ~ 10월 9일(금) 01:00');
});
