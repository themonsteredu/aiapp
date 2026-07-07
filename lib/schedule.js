'use strict';
const { q } = require('./db');

const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Seoul';
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// 지정 타임존 기준 현재 요일(0=일)과 자정 이후 경과 분을 구한다.
function nowInTimezone() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = DAY_INDEX[get('weekday')] ?? 0;
  const hour = Number(get('hour')) % 24; // 자정이 '24'로 나오는 환경 대비
  const minute = Number(get('minute'));
  return { day, minutes: hour * 60 + minute, hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

// 지정 타임존 기준 오늘 날짜 (YYYY-MM-DD)
function todayInTimezone() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

function toMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

async function listSchedules() {
  return q(
    `SELECT s.*, d.title AS deck_title FROM schedules s
     LEFT JOIN decks d ON d.id = s.deck_id
     ORDER BY s.day_of_week, s.start_time`
  );
}

function windowActive(w, now) {
  if (!w.enabled || w.day_of_week !== now.day) return false;
  const start = toMinutes(w.start_time);
  const end = toMinutes(w.end_time);
  return start !== null && end !== null && now.minutes >= start && now.minutes < end;
}

// 학생 접근 허용 여부.
// - 앱 전체 접근: 지금 활성화된 시간창(전체 또는 특정 웹앱)이 하나라도 있으면 허용
// - 특정 덱 접근(deckId 지정): 전체 허용 창 또는 그 덱의 창이 활성일 때 허용
async function checkAccess(deckId = null) {
  const now = nowInTimezone();
  const windows = await listSchedules();
  const active = windows.filter((w) => windowActive(w, now));
  const allowed = deckId === null
    ? active.length > 0
    : active.some((w) => w.deck_id === null || w.deck_id === Number(deckId));
  return {
    allowed,
    allowedDeckIds: active.some((w) => w.deck_id === null) ? null : active.map((w) => w.deck_id), // null = 전체 허용
    now: { day: now.day, dayName: DAY_NAMES[now.day], time: now.hhmm, timezone: TIMEZONE },
    windows: windows.map((w) => ({ ...w, dayName: DAY_NAMES[w.day_of_week] })),
  };
}

module.exports = { checkAccess, listSchedules, toMinutes, todayInTimezone, DAY_NAMES };
