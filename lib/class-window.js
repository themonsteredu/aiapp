'use strict';
// 수업 입장 코드의 입장 가능 시간(시작~마감).
// 화면(datetime-local)은 한국시간 벽시계 'YYYY-MM-DDTHH:MM'을 보낸다. 서버(Vercel)는 UTC라
// 받은 글자를 APP_TIMEZONE 기준 시각으로 바꿔 timestamptz 로 저장한다.
const { TIMEZONE } = require('./timezone');

const MIN_MINUTES = 10;      // 이보다 짧으면 입력 실수로 본다
const MAX_DAYS = 7;          // 1회성 수업 코드 — 임시 계정은 마감 하루 뒤 정리된다
const MAX_AHEAD_DAYS = 90;   // 미리 발급은 석 달 안쪽
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const WEEKDAY = { Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' };

function partsAt(ms) {
  return Object.fromEntries(PARTS.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
}

// 그 순간 시간대의 벽시계를 UTC 로 읽은 값과 실제 순간의 차 = 시간대 오프셋(ms)
function offsetAt(ms) {
  const p = partsAt(ms);
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return wall - Math.floor(ms / 1000) * 1000;
}

// 'YYYY-MM-DDTHH:MM[:SS]' (시간대 벽시계) → Date. 형식이 틀리거나 달력에 없는 날짜면 null
function localToDate(text) {
  const m = LOCAL.exec(String(text ?? '').trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const s = Number(m[6] || 0);
  if (h > 23 || mi > 59 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  // 두 번 보정: 서머타임이 있는 시간대의 경계 대비 (한국시간은 오프셋이 하나라 첫 값 그대로)
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

// Date → '10월 8일(목) 10:00' (시간대 기준)
function formatLocal(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = partsAt(date.getTime());
  return `${Number(p.month)}월 ${Number(p.day)}일(${WEEKDAY[p.weekday] || ''}) ${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}

// 같은 날이면 '10월 8일(목) 10:00 ~ 12:00', 날이 바뀌면 마감에도 날짜를 붙인다
function formatRange(start, end) {
  const a = formatLocal(start);
  const b = formatLocal(end);
  const day = (text) => text.slice(0, text.lastIndexOf(' '));
  return day(a) === day(b) ? `${a} ~ ${b.slice(b.lastIndexOf(' ') + 1)}` : `${a} ~ ${b}`;
}

// 새로 만들거나 바꿀 입장 시간 검사. 시작이 지금보다 앞서는 것은 허용한다(바로 시작하는 수업).
function classWindow(startText, endText, now = new Date()) {
  const start = localToDate(startText);
  const end = localToDate(endText);
  if (!start || !end) return { error: '입장 시작과 마감의 날짜·시각을 모두 입력하세요.' };
  const minutes = (end.getTime() - start.getTime()) / 60000;
  if (minutes <= 0) return { error: '마감 시각은 시작 시각보다 늦어야 합니다.' };
  if (minutes < MIN_MINUTES) return { error: `입장 가능 시간은 ${MIN_MINUTES}분 이상이어야 합니다.` };
  if (minutes > MAX_DAYS * 1440) return { error: `입장 가능 시간은 최대 ${MAX_DAYS}일까지 정할 수 있습니다.` };
  if (end.getTime() <= now.getTime()) return { error: '마감 시각이 이미 지났습니다. 마감 시각을 다시 정하세요.' };
  if (start.getTime() - now.getTime() > MAX_AHEAD_DAYS * 86400000) {
    return { error: `시작 시각은 오늘부터 ${MAX_AHEAD_DAYS}일 안으로 정하세요.` };
  }
  return { start, end, minutes: Math.round(minutes) };
}

module.exports = { classWindow, localToDate, formatLocal, formatRange, MIN_MINUTES, MAX_DAYS, MAX_AHEAD_DAYS };
