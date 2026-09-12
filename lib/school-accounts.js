'use strict';

// 모아허브(hub.moakit.ai)가 학교별로 발급한 학생 계정으로 모아랩에 로그인한다.
// 계정·비밀번호·명단의 원본은 중앙 테이블(moakit_accounts)이고 모아허브가 관리한다.
// 모아랩은 검증만 하고 자기 users 행을 school_account_id 로 연결한다.
// 진로기록의 student_id 는 계정에 붙은 career_student_id 라서, 학교 수업(모아허브)과
// 진로 수업(모아랩) 기록이 한 학생의 기록으로 모인다.
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const SCHOOL_USERNAME = /^m[a-f0-9]{20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// 모아허브 lib/student-accounts/security.js 와 같은 값. 바꾸면 한쪽 비밀번호가 안 맞는다.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const INVALID = '아이디 또는 비밀번호가 올바르지 않습니다.';
// users.password_hash 는 NOT NULL 이지만 학교 계정은 모아랩 비밀번호가 없다.
// 콜론이 없어 lib/password.js 의 verifyPassword 가 항상 false 를 돌려준다.
const NO_LOCAL_PASSWORD = 'school-account';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function isSchoolUsername(value) { return typeof value === 'string' && SCHOOL_USERNAME.test(value); }

async function passwordHash(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(value, salt, 64, SCRYPT);
  return `scrypt1:${salt}:${key.toString('hex')}`;
}

async function passwordMatches(value, stored) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const match = /^scrypt1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(stored || '');
  if (!match) return false;
  const key = await scrypt(value, match[1], 64, SCRYPT);
  return crypto.timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}

// 모아허브 명단의 "2학년 1반 3번" 은 학생 한 명의 자리다. 모아랩의 반은 웹앱 배정 단위라
// 번호를 뺀 "학교명 2학년 1반" 으로 만든다. 번호는 개인 식별이라 반 이름에 넣지 않는다.
function className(schoolName, label) {
  const parsed = /^(\d{1,2})학년 +(\d{1,2})반 +\d{1,3}번$/.exec(String(label || '').trim());
  const unit = parsed ? `${parsed[1]}학년 ${parsed[2]}반` : String(label || '').trim();
  return `${String(schoolName || '').trim()} ${unit}`.trim().slice(0, 50);
}

function createSchoolAccounts({ q, one, withTransaction }) {
  // 모아허브와 같은 잠금 규칙·같은 테이블. 한쪽에서 틀린 시도가 쌓이면 양쪽 모두 15분 잠긴다.
  async function countAttempts(username, clientKey) {
    await withTransaction(async tx => {
      for (const [key, limit] of [[sha256('user:' + username), 20], [sha256('client:' + clientKey), 500]]) {
        const rows = await tx.q(`INSERT INTO moakit_accounts.login_limits VALUES ($1, 1, now() + interval '15 minutes')
          ON CONFLICT (key_hash) DO UPDATE SET
            attempts = CASE WHEN moakit_accounts.login_limits.resets_at < now() THEN 1 ELSE moakit_accounts.login_limits.attempts + 1 END,
            resets_at = CASE WHEN moakit_accounts.login_limits.resets_at < now() THEN now() + interval '15 minutes' ELSE moakit_accounts.login_limits.resets_at END
          RETURNING attempts`, [key]);
        if (rows[0].attempts > limit) fail(429, '로그인 시도가 많습니다. 15분 후 다시 시도하세요.');
      }
    });
  }

  // 성공하면 연결된(없으면 새로 만든) users 행을 돌려준다. 이름·반·비밀번호 변경 요구는
  // 로그인할 때마다 모아허브 명단 기준으로 맞춘다.
  async function login(username, password, clientKey) {
    if (!isSchoolUsername(username) || typeof password !== 'string' || password.length > 128) fail(401, INVALID);
    // 실패 횟수는 별도 트랜잭션에 남겨야 로그인 실패로 되돌려지지 않는다.
    await countAttempts(username, String(clientKey || 'unknown'));
    return withTransaction(async tx => {
      const account = await tx.one(
        'SELECT id, career_student_id, username, password_hash, must_change_password, active FROM moakit_accounts.accounts WHERE username = $1',
        [username]);
      if (!account || !account.active || !await passwordMatches(password, account.password_hash)) fail(401, INVALID);
      if (!UUID.test(String(account.id)) || !UUID.test(String(account.career_student_id))) fail(401, INVALID);
      const membership = await tx.one(`SELECT m.display_name, m.class_name, s.name AS school_name
        FROM moakit_accounts.memberships m JOIN moakit_accounts.schools s ON s.id = m.school_id
        WHERE m.account_id = $1 AND m.active = true ORDER BY s.name LIMIT 1`, [account.id]);
      if (!membership) fail(403, '학교 소속이 없는 계정입니다. 학교 담당 선생님에게 문의하세요.');
      const name = String(membership.display_name || '').trim().slice(0, 80) || '학생';
      const cls = className(membership.school_name, membership.class_name);
      // 두 탭에서 동시에 처음 로그인해도 연결 행은 하나만 생긴다.
      await tx.q("SELECT pg_advisory_xact_lock(hashtext('job-school-account'), hashtext($1))", [String(account.id)]);
      const linked = await tx.one('SELECT id FROM users WHERE school_account_id = $1', [account.id]);
      if (linked) {
        return tx.one('UPDATE users SET name = $1, class_name = $2, must_change_password = $3 WHERE id = $4 RETURNING *',
          [name, cls, account.must_change_password === true, linked.id]);
      }
      const taken = await tx.one('SELECT id FROM users WHERE username = $1', [account.username]);
      if (taken) fail(409, '같은 아이디의 모아랩 계정이 이미 있어 연결할 수 없습니다. 관리자에게 문의하세요.');
      return tx.one(`INSERT INTO users (username, password_hash, name, role, class_name, must_change_password, school_account_id)
        VALUES ($1, $2, $3, 'student', $4, $5, $6) RETURNING *`,
      [account.username, NO_LOCAL_PASSWORD, name, cls, account.must_change_password === true, account.id]);
    });
  }

  // 모아허브와 같은 규칙: 중앙 계정의 비밀번호를 바꾸고 모아허브 쪽 학생 세션을 모두 끝낸다.
  async function changePassword(user, current, next) {
    if (!user?.school_account_id) fail(400, '학교 학생 계정이 아닙니다.');
    if (typeof next !== 'string' || next.length < 8 || next.length > 128) fail(400, '새 비밀번호는 8~128자로 입력하세요.');
    if (current === next) fail(400, '새 비밀번호를 다르게 입력하세요.');
    await withTransaction(async tx => {
      const account = await tx.one('SELECT password_hash, active FROM moakit_accounts.accounts WHERE id = $1 FOR UPDATE', [user.school_account_id]);
      if (!account || !account.active) fail(401, '학교 학생 계정을 확인할 수 없습니다. 다시 로그인하세요.');
      if (!await passwordMatches(String(current || ''), account.password_hash)) fail(400, '현재 비밀번호가 올바르지 않습니다.');
      await tx.q('UPDATE moakit_accounts.accounts SET password_hash = $1, must_change_password = false WHERE id = $2',
        [await passwordHash(next), user.school_account_id]);
      await tx.q('DELETE FROM moakit_accounts.sessions WHERE account_id = $1', [user.school_account_id]);
      await tx.q('UPDATE users SET must_change_password = false WHERE id = $1', [user.id]);
    });
  }

  // 진로기록에 쓰는 학생 번호. 계정이 비활성이면 null 이라 기록을 읽고 쓸 수 없다.
  async function careerStudentId(user) {
    if (!user?.school_account_id) return null;
    const row = await one('SELECT career_student_id FROM moakit_accounts.accounts WHERE id = $1 AND active = true', [user.school_account_id]);
    return row && UUID.test(String(row.career_student_id)) ? String(row.career_student_id).toLowerCase() : null;
  }

  return { login, changePassword, careerStudentId };
}

module.exports = { SCHOOL_USERNAME, isSchoolUsername, passwordHash, passwordMatches, className, createSchoolAccounts };
