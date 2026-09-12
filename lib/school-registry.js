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

  // ---- 진로기록 열람·수정 권한 ----
  // 관리자는 중앙에 등록된 모든 학교를 열람·수정한다. 그 밖에는 record_access 행의 level 을 따른다.
  async function recordLevel(tx, user, school) {
    if (!staffLevel(user) || !uuid(school)) return null;
    if (adminLevel(user)) return (await tx.one('SELECT 1 FROM moakit_accounts.schools WHERE id = $1', [school])) ? 'edit' : null;
    const row = await tx.one('SELECT level FROM moakit_accounts.record_access WHERE school_id = $1 AND issuer = $2 AND user_id = $3', [school, ISSUER, String(user.id)]);
    return row ? row.level : null;
  }
  async function authorizeRecords(tx, user, school, needed = 'view') {
    const level = await recordLevel(tx, user, school);
    if (!level || (needed === 'edit' && level !== 'edit')) fail(403, needed === 'edit' ? '기록 수정 권한이 없습니다.' : '기록 열람 권한이 없습니다.');
    return level;
  }
  async function studentOf(tx, school, accountId) {
    if (!uuid(accountId)) fail(400, '학생을 확인해 주세요.');
    const student = await tx.one(`SELECT a.id, a.username, a.career_student_id, m.display_name, m.class_name
      FROM moakit_accounts.accounts a JOIN moakit_accounts.memberships m ON m.account_id = a.id
      WHERE a.id = $1 AND m.school_id = $2 AND m.active = true`, [accountId, school]);
    if (!student) fail(404, '학생을 찾을 수 없습니다.');
    return student;
  }
  // 기록 본문 검증. 학교 수업 기록(모아허브)은 돌아보기가 없을 수 있어 선택으로 둔다.
  function recordInput(body, { requireTitle = false } = {}) {
    const out = {};
    for (const [key, max, required] of [['title', 120, requireTitle], ['process', 1500, true], ['artifact', 1500, false], ['reflection', 1000, false]]) {
      const value = body?.[key] ?? '';
      if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, '활동 과정을 포함해 내용을 확인해 주세요.');
      out[key] = value.trim();
    }
    if (body?.occurred_at !== undefined && body?.occurred_at !== '') {
      const at = new Date(String(body.occurred_at));
      if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 86_400_000 || at.getFullYear() < 2000) fail(400, '활동 날짜를 확인해 주세요.');
      out.occurredAt = at.toISOString();
    }
    return out;
  }
  const RECORD_SELECT = `SELECT r.id, r.source, r.program_ref, r.session_ref, r.occurred_at, r.process, r.artifact, r.reflection,
      r.verification_status, r.supersedes_id, r.created_at,
      COALESCE(r.raw_data->'job'->>'title', r.raw_data->'job'->>'deck_title', '') AS title,
      COALESCE(r.raw_data->'job'->>'session_title', '') AS session_title,
      r.raw_data->'job'->>'entry_kind' AS entry_kind, r.raw_data->'job'->>'author_name' AS author_name
    FROM career_log.records r`;

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

    // ---- 진로기록 열람·수정 ----
    async canViewRecords(user) {
      if (!staffLevel(user)) return false;
      if (adminLevel(user)) return true;
      return withTransaction(async tx => !!(await tx.one('SELECT 1 FROM moakit_accounts.record_access WHERE issuer = $1 AND user_id = $2 LIMIT 1', [ISSUER, String(user.id)])));
    },
    // 기록을 볼 수 있는 학교. 관리자는 중앙에 등록된 모든 학교(edit), 그 밖에는 권한을 받은 학교만.
    async recordSchools(user) {
      if (!staffLevel(user)) fail(403, '기록 열람 권한이 없습니다.');
      return withTransaction(async tx => {
        if (adminLevel(user)) {
          return (await tx.q('SELECT id, name FROM moakit_accounts.schools ORDER BY name', [])).map(row => ({ id: row.id, name: row.name, level: 'edit' }));
        }
        const granted = await tx.q(`SELECT s.id, s.name, v.level FROM moakit_accounts.record_access v JOIN moakit_accounts.schools s ON s.id = v.school_id
          WHERE v.issuer = $1 AND v.user_id = $2 ORDER BY s.name`, [ISSUER, String(user.id)]);
        return granted.map(row => ({ id: row.id, name: row.name, level: row.level }));
      });
    },
    async members(user, school) {
      return withTransaction(async tx => {
        const level = await authorizeRecords(tx, user, school, 'view');
        const rows = await tx.q(`SELECT a.id, a.username, a.active, m.display_name, m.class_name
          FROM moakit_accounts.memberships m JOIN moakit_accounts.accounts a ON a.id = m.account_id
          WHERE m.school_id = $1 AND m.active = true`, [school]);
        return { level, students: rows.map(row => ({ ...row, ...R.fromLabel(row.class_name) })).sort(R.compare) };
      });
    },
    // 최신 버전만 보여준다(정정된 원본은 이력으로). page 0 조회는 감사 기록에 남긴다.
    async studentRecords(user, school, accountId, { page = 0 } = {}) {
      if (!Number.isInteger(page) || page < 0 || page > 9999) fail(400, '페이지 값이 올바르지 않습니다.');
      return withTransaction(async tx => {
        const level = await authorizeRecords(tx, user, school, 'view');
        const student = await studentOf(tx, school, accountId);
        const rows = await tx.q(`${RECORD_SELECT}
          WHERE r.student_id = $1 AND NOT EXISTS (SELECT 1 FROM career_log.records n WHERE n.student_id = r.student_id AND n.supersedes_id = r.id)
          ORDER BY r.occurred_at DESC, r.id DESC LIMIT 26 OFFSET $2`, [student.career_student_id, page * 25]);
        if (page === 0) await audit(tx, user, school, 'records_viewed', student.id);
        return {
          level,
          student: { id: student.id, username: student.username, displayName: student.display_name, className: student.class_name, ...R.fromLabel(student.class_name) },
          records: rows.slice(0, 25), hasMore: rows.length > 25,
        };
      });
    },
    // 정정 이력: 이 기록이 대체한 이전 버전들을 최신순으로.
    async recordHistory(user, school, accountId, recordId) {
      if (!uuid(recordId)) fail(400, '기록을 확인해 주세요.');
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'view');
        const student = await studentOf(tx, school, accountId);
        const rows = await tx.q(`WITH RECURSIVE chain AS (
            SELECT r.id, r.supersedes_id, 0 AS depth FROM career_log.records r WHERE r.id = $1 AND r.student_id = $2
            UNION ALL
            SELECT p.id, p.supersedes_id, chain.depth + 1 FROM career_log.records p JOIN chain ON p.id = chain.supersedes_id AND p.student_id = $2 WHERE chain.depth < 50)
          ${RECORD_SELECT.replace('FROM career_log.records r', 'FROM chain JOIN career_log.records r ON r.id = chain.id')} WHERE chain.depth > 0 ORDER BY chain.depth`, [recordId, student.career_student_id]);
        return { history: rows };
      });
    },
    // 정정: 원본은 그대로 두고 supersedes_id 로 이어지는 새 버전을 넣는다. 이미 정정된 버전이면 409.
    async reviseRecord(user, school, accountId, recordId, body, authorName) {
      if (!uuid(recordId)) fail(400, '기록을 확인해 주세요.');
      const input = recordInput(body);
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'edit');
        const student = await studentOf(tx, school, accountId);
        await tx.q("SELECT pg_advisory_xact_lock(hashtext('job-record-revise'), hashtext($1))", [recordId]);
        const original = await tx.one('SELECT * FROM career_log.records WHERE id = $1 AND student_id = $2', [recordId, student.career_student_id]);
        if (!original) fail(404, '기록을 찾을 수 없습니다.');
        if (await tx.one('SELECT 1 FROM career_log.records WHERE student_id = $1 AND supersedes_id = $2', [student.career_student_id, recordId])) fail(409, '이미 정정된 기록입니다. 최신 내용을 다시 불러온 뒤 수정하세요.');
        const raw = original.raw_data && typeof original.raw_data === 'object' ? original.raw_data : {};
        const job = { ...(raw.job && typeof raw.job === 'object' ? raw.job : {}), entry_kind: 'revision', revised_by: actor(user), author_name: authorName, original_source: original.source, school_id: school };
        if (input.title) job.title = input.title;
        const saved = await tx.one(`INSERT INTO career_log.records
            (student_id, session_ref, program_ref, occurred_at, process, artifact, reflection, source, verification_status, verified_by, verified_at, raw_data, source_event_id, supersedes_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'job', NULL, NULL, NULL, $8::jsonb, $9, $10) RETURNING id`,
        [student.career_student_id, original.session_ref, original.program_ref, input.occurredAt || original.occurred_at, input.process, input.artifact || null, input.reflection || null,
          JSON.stringify({ ...raw, job }), `job-revision:${recordId}:${crypto.randomUUID()}`, recordId]);
        await audit(tx, user, school, 'record_revised', student.id);
        return { id: saved.id, supersedes: recordId };
      });
    },
    // 담당자가 학생 기록을 새로 남긴다 (기관 수업·상담 등).
    async addRecord(user, school, accountId, body, authorName) {
      const input = recordInput(body, { requireTitle: true });
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'edit');
        const student = await studentOf(tx, school, accountId);
        const schoolRow = await tx.one('SELECT name FROM moakit_accounts.schools WHERE id = $1', [school]);
        const job = { entry_kind: 'staff_record', title: input.title, author: actor(user), author_name: authorName, school_id: school, school_name: schoolRow?.name || '', session_title: input.title };
        const saved = await tx.one(`INSERT INTO career_log.records
            (student_id, session_ref, program_ref, occurred_at, process, artifact, reflection, source, verification_status, verified_by, verified_at, raw_data, source_event_id, supersedes_id)
          VALUES ($1, $2, 'job-staff-record', $3, $4, $5, $6, 'job', NULL, NULL, NULL, $7::jsonb, $8, NULL) RETURNING id`,
        [student.career_student_id, `job-school:${school}`, input.occurredAt || new Date().toISOString(), input.process, input.artifact || null, input.reflection || null,
          JSON.stringify({ job }), `job-staff:${student.career_student_id}:${crypto.randomUUID()}`]);
        await audit(tx, user, school, 'record_added', student.id);
        return { id: saved.id };
      });
    },
    // 관리자는 어느 학교든 기록 권한을 주고 거둘 수 있다 (학교 존재만 확인).
    async recordAccessList(user, school) {
      if (!adminLevel(user)) fail(403, '관리자만 기록 권한을 관리할 수 있습니다.');
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'edit');
        return tx.q('SELECT user_id, level, granted_by, created_at FROM moakit_accounts.record_access WHERE school_id = $1 AND issuer = $2 ORDER BY created_at', [school, ISSUER]);
      });
    },
    // level 이 null 이면 권한 해제.
    async setRecordAccess(user, school, userId, level) {
      if (!adminLevel(user)) fail(403, '관리자만 기록 권한을 관리할 수 있습니다.');
      if (level !== null && !['view', 'edit'].includes(level)) fail(400, '권한 종류를 확인하세요.');
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'edit');
        if (level) await tx.q(`INSERT INTO moakit_accounts.record_access (school_id, issuer, user_id, level, granted_by) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (school_id, issuer, user_id) DO UPDATE SET level = EXCLUDED.level, granted_by = EXCLUDED.granted_by, created_at = now()`, [school, ISSUER, String(userId), level, actor(user)]);
        else await tx.q('DELETE FROM moakit_accounts.record_access WHERE school_id = $1 AND issuer = $2 AND user_id = $3', [school, ISSUER, String(userId)]);
        await audit(tx, user, school, level ? `record_access_granted:${level}:${userId}` : `record_access_revoked:${userId}`);
      });
    },
  };
}

module.exports = { ISSUER, ISSUERS, createSchoolRegistry };
