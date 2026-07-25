'use strict';

const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Seoul';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE });

// DB DATE, ISO 문자열, Date 객체를 지정 타임존의 YYYY-MM-DD로 통일한다.
function dateInTimezone(value) {
  if (!value) return '';
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
    if (dateOnly) return dateOnly[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DATE_FORMATTER.format(date);
}

module.exports = { TIMEZONE, dateInTimezone };
