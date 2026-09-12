'use strict';

// 모아랩에서 학교·기관의 모아킷 공통 학생 계정(중앙 moakit_accounts)을 발급·관리한다.
// 규칙은 모아허브 lib/student-accounts/service.js 와 같다:
//  - 학생 번호(career_student_id)는 무작위 UUID. 이름·학교·계정 ID로 만들지 않는다
//  - 담당자(managers)이거나, 이 제품에 열린 학교(school_access)의 관리자만 관리한다
//  - 발급·수정·초기화는 한 트랜잭션 안에서 권한 확인 → 변경 → 감사 기록
const crypto = require('node:crypto');
const R = require('./school-roster');
const { passwordHash } = require('./school-accounts');

const ISSUER = 'moakit-lab';
const ISSUERS = ['moakit-hub', 'moakit-lab'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = value => typeof value === 'string' && UUID.test(value);
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, '입력 내용을 확인해 주세요.');
  return value.trim();
}

function createSchoolRegistry({ withTransaction, roleLevel }) {
  const adminLevel = user => roleLevel(user?.role) >= roleLevel('admin');
  const staffLevel = user => roleLevel(user?.role) >= roleLevel('instructor');
  const actor = user => `${ISSUER}:${user.id}`;
  async function authorize(tx, user, school) {
    if (!staffLevel(user) || !uuid(school)) fail(403, '학교 관리 권한이 없습니다.');
    if (await tx.one('SELECT 1 FROM moakit_accounts.managers WHERE school_id = $1 AND issuer = $2 AND teacher_id = $3 FOR SHARE', [school, ISSUER, String(user.id)])) return;
    // 다른 제품(모아허브)에서 모아랩에 열어 준 학교는 관리자가 담당자 지정 없이 관리한다.
    if (adminLevel(user) && await tx.one('SELECT 1 FROM moakit_accounts.school_access WHERE school_id = $1 AND issuer = $2 FOR SHARE', [school, ISSUER])) return;
    fail(403, '학교 관리 권한이 없습니다.');
  }
  const audit = (tx, user, school, action, account = null) =>
    tx.q('INSERT INTO moakit_accounts.audit (school_id, actor, action, account_id) VALUES ($1, $2, $3, $4)', [school, actor(user), action, account]);
  const temporaryPassword = () => crypto.randomBytes(12).toString('base64url');

  return {
    // 담당 학교 + (관리자라면) 다른 제품이 모아랩에 열어 준 학교. openedTo 는 이 학교가 열린 다른 제품 목록.
    async schools(user) {
      if (!staffLevel(user)) fail(403, '학교 관리 권한이 없습니다.');
      return withTransaction(async tx => (await tx.q(`SELECT s.id, s.name, bool_or(m.teacher_id IS NOT NULL) AS manager,
          COALESCE(array_agg(DISTINCT a.issuer) FILTER (WHERE a.issuer IS NOT NULL), '{}') AS opened_to
        FROM moakit_accounts.schools s
        LEFT JOIN moakit_accounts.managers m ON m.school_id = s.id AND m.issuer = $1 AND m.teacher_id = $2
        LEFT JOIN moakit_accounts.school_access a ON a.school_id = s.id
        GROUP BY s.id, s.name
        HAVING bool_or(m.teacher_id IS NOT NULL) OR ($3::boolean AND bool_or(a.issuer = $1))
        ORDER BY s.name`, [ISSUER, String(user.id), adminLevel(user)]))
        .map(row => ({ id: row.id, name: row.name, via: row.manager ? 'manager' : 'open', openedTo: (row.opened_to || []).filter(value => value !== ISSUER) })));
    },
    async createSchool(user, name) {
      if (!adminLevel(user)) fail(403, '관리자만 학교·기관을 등록할 수 있습니다.');
      name = text(name, 120);
      return withTransaction(async tx => {
        const school = await tx.one('INSERT INTO moakit_accounts.schools (name) VALUES ($1) RETURNING id, name', [name]);
        await tx.q('INSERT INTO moakit_accounts.managers VALUES ($1, $2, $3)', [school.id, ISSUER, String(user.id)]);
        await audit(tx, user, school.id, 'school_created');
        return school;
      });
    },
    // 다른 모아킷 제품(모아허브)에 학교 열기·닫기.
    async setAccess(user, school, target, enabled) {
      if (!adminLevel(user)) fail(403, '관리자만 다른 제품에 학교를 열 수 있습니다.');
      if (!ISSUERS.includes(target) || target === ISSUER) fail(400, '열어 줄 제품을 확인하세요.');
      return withTransaction(async tx => {
        await authorize(tx, user, school);
        if (enabled) await tx.q('INSERT INTO moakit_accounts.school_access (school_id, issuer, opened_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [school, target, actor(user)]);
        else await tx.q('DELETE FROM moakit_accounts.school_access WHERE school_id = $1 AND issuer = $2', [school, target]);
        await audit(tx, user, school, `${enabled ? 'access_opened' : 'access_closed'}:${target}`);
      });
    },
    // 호출한 쪽이 instructorId 가 활성 강사 계정인지 확인한 뒤 부른다.
    async grantManager(user, school, instructorId) {
      if (!adminLevel(user)) fail(403, '관리자만 담당 강사를 지정할 수 있습니다.');
      return withTransaction(async tx => {
        await authorize(tx, user, school);
        await tx.q('INSERT INTO moakit_accounts.managers VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [school, ISSUER, String(instructorId)]);
        await audit(tx, user, school, 'manager_granted');
      });
    },
    async list(user, school) {
      return withTransaction(async tx => {
        await authorize(tx, user, school);
        const rows = await tx.q(`SELECT a.id, a.username, a.active, a.must_change_password, m.display_name, m.class_name
          FROM moakit_accounts.memberships m JOIN moakit_accounts.accounts a ON a.id = m.account_id
          WHERE m.school_id = $1 AND m.active = true ORDER BY m.class_name, m.display_name`, [school]);
        return rows.map(row => ({ ...row, ...R.fromLabel(row.class_name) })).sort(R.compare);
      });
    },
    async provision(user, school, input) {
      const rows = R.validate(input);
      return withTransaction(async tx => {
        await authorize(tx, user, school);
        await R.checkAvailable(tx, school, rows);
        const result = [];
        for (const row of rows) {
          const studentId = crypto.randomUUID();
          const username = 'm' + crypto.randomBytes(10).toString('hex');
          const password = temporaryPassword();
          await tx.q('INSERT INTO career_log.students (id) VALUES ($1)', [studentId]);
          const account = await tx.one('INSERT INTO moakit_accounts.accounts (career_student_id, username, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [studentId, username, await passwordHash(password)]);
          await tx.q('INSERT INTO moakit_accounts.memberships (account_id, school_id, display_name, class_name) VALUES ($1, $2, $3, $4)',
            [account.id, school, row.displayName, row.className]);
          await audit(tx, user, school, 'account_issued', account.id);
          result.push({ id: account.id, username, temporaryPassword: password, ...row });
        }
        return result;
      });
    },
    async updateMember(user, school, id, input) {
      if (!uuid(id)) fail(400, '학생을 확인해 주세요.');
      const row = R.normalize(input);
      return withTransaction(async tx => {
        await authorize(tx, user, school);
        await R.checkAvailable(tx, school, [row], id);
        const updated = await tx.one('UPDATE moakit_accounts.memberships SET display_name = $1, class_name = $2 WHERE account_id = $3 AND school_id = $4 AND active = true RETURNING account_id',
          [row.displayName, row.className, id, school]);
        if (!updated) fail(404, '학생을 찾을 수 없습니다.');
        await audit(tx, user, school, 'membership_updated', id);
      });
    },
    async reset(user, school, id) {
      if (!uuid(id)) fail(400, '학생을 확인해 주세요.');
      return withTransaction(async tx => {
        await authorize(tx, user, school);
        const account = await tx.one('SELECT a.id FROM moakit_accounts.accounts a JOIN moakit_accounts.memberships m ON m.account_id = a.id WHERE a.id = $1 AND m.school_id = $2 AND m.active = true FOR UPDATE OF a', [id, school]);
        if (!account) fail(404, '학생을 찾을 수 없습니다.');
        const password = temporaryPassword();
        await tx.q('UPDATE moakit_accounts.accounts SET password_hash = $1, must_change_password = true WHERE id = $2', [await passwordHash(password), id]);
        await tx.q('DELETE FROM moakit_accounts.sessions WHERE account_id = $1', [id]);
        await audit(tx, user, school, 'password_reset', id);
        return { temporaryPassword: password };
      });
    },
  };
}

module.exports = { ISSUER, ISSUERS, createSchoolRegistry };
