'use strict';
// 모아허브 lib/student-accounts/roster.js 를 모아랩 트랜잭션 API(tx.q)에 맞게 옮긴 것. 규칙은 같다.
// 명단 정보(학년·반·번호·이름)는 사람이 읽는 소속 표시일 뿐, 계정이나 진로기록 번호를 만들지 않는다.
// 제어문자(줄바꿈·탭 등) 검사. 문자 코드 0~31, 127.
const CONTROL = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + ']');
function fail(message) { throw Object.assign(new Error(message), { status: 400 }); }
function integer(value, max, label) {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value).trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > max) fail(`${label}${label === '번호' ? '는' : '은'} 1~${max} 사이의 숫자로 입력하세요.`);
  return Number(value);
}
function fromLabel(value) {
  const match = typeof value === 'string' ? /^(\d{1,2})학년 +(\d{1,2})반 +(\d{1,3})번$/.exec(value) : null;
  if (!match) return { grade: null, classNumber: null, studentNumber: null };
  const [grade, classNumber, studentNumber] = match.slice(1).map(Number);
  return grade >= 1 && grade <= 6 && classNumber >= 1 && classNumber <= 99 && studentNumber >= 1 && studentNumber <= 999
    ? { grade, classNumber, studentNumber } : { grade: null, classNumber: null, studentNumber: null };
}
function normalize(row) {
  if (!row || typeof row.displayName !== 'string' || !row.displayName.trim() || row.displayName.trim().length > 80 || CONTROL.test(row.displayName.trim())) fail('학생 이름을 줄바꿈 없이 1~80자로 입력하세요.');
  const displayName = row.displayName.trim();
  if (['grade', 'classNumber', 'studentNumber'].some(key => row[key] !== undefined && row[key] !== null)) {
    const grade = integer(row.grade, 6, '학년'), classNumber = integer(row.classNumber, 99, '반'), studentNumber = integer(row.studentNumber, 999, '번호');
    return { displayName, grade, classNumber, studentNumber, className: `${grade}학년 ${classNumber}반 ${studentNumber}번` };
  }
  if (typeof row.className !== 'string' || !row.className.trim() || row.className.trim().length > 80 || CONTROL.test(row.className.trim())) fail('학생의 반 정보를 확인하세요.');
  const className = row.className.trim();
  return { displayName, className, ...fromLabel(className) };
}
function key(row) {
  const parsed = row.grade && row.classNumber && row.studentNumber ? row : fromLabel(row.className || row.class_name);
  return parsed.grade ? `${parsed.grade}학년 ${parsed.classNumber}반 ${parsed.studentNumber}번` : null;
}
function validate(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) fail('한 번에 1~100명을 등록할 수 있습니다.');
  const rows = input.map(normalize), seen = new Set();
  for (const row of rows) { const value = key(row); if (value && seen.has(value)) fail(`${value}이 명단에 중복되어 있습니다.`); if (value) seen.add(value); }
  return rows;
}
// 같은 학교의 명단 쓰기는 같은 잠금을 잡는다 (모아허브와 같은 키). 두 요청이 같은 자리를 동시에 차지하지 못한다.
async function checkAvailable(tx, school, rows, excludeId) {
  await tx.q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`moakit-account-roster:${String(school).toLowerCase()}`]);
  const existing = await tx.q('SELECT account_id, class_name FROM moakit_accounts.memberships WHERE school_id = $1 AND active = true', [school]);
  const excluded = excludeId === undefined ? null : String(excludeId).toLowerCase();
  const occupied = new Set(existing.filter(row => excluded === null || String(row.account_id).toLowerCase() !== excluded).map(key).filter(Boolean));
  for (const row of rows) {
    const value = key(row);
    if (value && occupied.has(value)) throw Object.assign(new Error(`${value}은 이미 등록되어 있습니다. 기존 학생의 소속 정보를 확인하세요.`), { status: 409 });
  }
}
function compare(a, b) {
  const x = fromLabel(a.class_name), y = fromLabel(b.class_name);
  if (x.grade && y.grade) return x.grade - y.grade || x.classNumber - y.classNumber || x.studentNumber - y.studentNumber || String(a.display_name).localeCompare(String(b.display_name), 'ko');
  if (x.grade || y.grade) return x.grade ? -1 : 1;
  return String(a.class_name).localeCompare(String(b.class_name), 'ko', { numeric: true }) || String(a.display_name).localeCompare(String(b.display_name), 'ko');
}
module.exports = { normalize, fromLabel, key, validate, checkAvailable, compare };
