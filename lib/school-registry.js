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

// 활동 사진: 브라우저에서 줄여 보낸 data URL 만 받는다. 원본은 career_record_photos 에 base64 로 둔다.
const PHOTO_DATA = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_PHOTOS = 6;
// Vercel 은 요청 본문을 4.5MB 에서 자른다 (server.js 주석). 그 한도를 넘으면 이 핸들러까지 오지도 못하므로
// 장당 상한만으로는 부족하고 한 요청의 사진 합계도 막아야 한다. 글 내용과 JSON 덧붙는 양까지 감안해 넉넉히 남긴다.
const MAX_PHOTO_CHARS = 900_000;          // base64 기준 약 660KB — 1280px JPEG 이면 충분하다
const MAX_PHOTOS_TOTAL_CHARS = 3_200_000; // base64 기준 약 2.3MB
function photoInput(list) {
  if (list === undefined || list === null || list === '') return [];
  if (!Array.isArray(list)) fail(400, '사진 목록을 확인해 주세요.');
  if (list.length > MAX_PHOTOS) fail(400, `사진은 한 기록에 최대 ${MAX_PHOTOS}장까지 넣을 수 있습니다.`);
  let total = 0;
  return list.map((item, index) => {
    const m = PHOTO_DATA.exec(String(item?.data || ''));
    if (!m) fail(400, '사진은 JPG·PNG·WEBP 이미지만 넣을 수 있습니다.');
    if (m[2].length > MAX_PHOTO_CHARS) fail(400, '사진 한 장이 너무 큽니다. 더 작은 사진으로 올려 주세요.');
    total += m[2].length;
    if (total > MAX_PHOTOS_TOTAL_CHARS) fail(400, '한 번에 올리는 사진 용량이 너무 큽니다. 장수를 줄이거나 나눠서 올려 주세요.');
    return { mime: m[1], data: m[2], caption: String(item?.caption ?? '').trim().slice(0, 120), position: index };
  });
}

// 진로 관찰 기록은 학생이 쓰는 3칸(활동 과정·결과물·돌아보기)과 묻는 것이 다르다.
// 원본 표의 칸은 그대로 쓰되(다른 화면·모아허브가 읽으므로) 무엇을 적은 칸인지는 raw_data.job.observation 에 남긴다.
const OBSERVATION_FIELDS = [
  ['activity', 'process', 1500, true],      // 수업에서 한 활동과 학생의 모습
  ['strengths', 'artifact', 1500, false],   // 드러난 강점·흥미
  ['next_step', 'reflection', 1000, false], // 추천하는 다음 활동
];

function createSchoolRegistry({ withTransaction, roleLevel }) {
  const adminLevel = user => roleLevel(user?.role) >= roleLevel('admin');
  const staffLevel = user => roleLevel(user?.role) >= roleLevel('instructor');
  // 기록 화면을 쓸 수 있는 계정: 강사 이상 + 진로업체 담당자(partner).
  // 학교·계정 발급 기능은 staffLevel 그대로라 partner 는 닿지 않는다.
  const recordUser = user => staffLevel(user) || user?.role === 'partner';
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
    if (!recordUser(user) || !uuid(school)) return null;
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
  // kind='career_observation' 이면 진로 관찰 항목 이름으로 받아 같은 칸에 넣는다.
  function recordInput(body, { requireTitle = false, kind = 'staff_record' } = {}) {
    const out = {};
    const observation = kind === 'career_observation';
    const fields = observation
      ? [['title', 120, requireTitle], ...OBSERVATION_FIELDS.map(([key, , max, required]) => [key, max, required])]
      : [['title', 120, requireTitle], ['process', 1500, true], ['artifact', 1500, false], ['reflection', 1000, false]];
    for (const [key, max, required] of fields) {
      const value = body?.[key] ?? '';
      if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
        fail(400, observation ? '제목과 활동 모습을 확인해 주세요.' : '활동 과정을 포함해 내용을 확인해 주세요.');
      }
      out[key] = value.trim();
    }
    if (observation) {
      out.observation = Object.fromEntries(OBSERVATION_FIELDS.map(([key]) => [key, out[key]]));
      for (const [key, column] of OBSERVATION_FIELDS) { out[column] = out[key]; delete out[key]; }
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
      r.raw_data->'job'->>'entry_kind' AS entry_kind, r.raw_data->'job'->>'author_name' AS author_name,
      r.raw_data->'job'->>'original_source' AS original_source, r.raw_data->'job'->'observation' AS observation
    FROM career_log.records r`;

  // 기록 목록에 붙일 사진 목록. 사진 바이트는 내려보내지 않고 /api/career-photos/<id> 로만 연다.
  async function attachPhotos(tx, rows) {
    const ids = rows.map(row => row.id);
    if (!ids.length) return rows;
    const photos = await tx.q('SELECT id, record_id, mime, caption, position FROM career_record_photos WHERE record_id = ANY($1::uuid[]) ORDER BY position, created_at', [ids]);
    const byRecord = new Map();
    for (const photo of photos) {
      if (!byRecord.has(photo.record_id)) byRecord.set(photo.record_id, []);
      byRecord.get(photo.record_id).push({ id: photo.id, mime: photo.mime, caption: photo.caption });
    }
    return rows.map(row => ({ ...row, photos: byRecord.get(row.id) || [] }));
  }
  async function insertPhotos(tx, { recordId, studentUuid, school, photos, author }) {
    for (const photo of photos) {
      await tx.q(`INSERT INTO career_record_photos (record_id, student_uuid, school_id, mime, data, caption, position, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [recordId, studentUuid, school, photo.mime, photo.data, photo.caption, photo.position, author]);
    }
  }

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
      if (!recordUser(user)) return false;
      if (adminLevel(user)) return true;
      return withTransaction(async tx => !!(await tx.one('SELECT 1 FROM moakit_accounts.record_access WHERE issuer = $1 AND user_id = $2 LIMIT 1', [ISSUER, String(user.id)])));
    },
    // 기록을 볼 수 있는 학교. 관리자는 중앙에 등록된 모든 학교(edit), 그 밖에는 권한을 받은 학교만.
    async recordSchools(user) {
      if (!recordUser(user)) fail(403, '기록 열람 권한이 없습니다.');
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
          records: await attachPhotos(tx, rows.slice(0, 25)), hasMore: rows.length > 25,
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
        return { history: await attachPhotos(tx, rows) };
      });
    },
    // 정정: 원본은 그대로 두고 supersedes_id 로 이어지는 새 버전을 넣는다. 이미 정정된 버전이면 409.
    async reviseRecord(user, school, accountId, recordId, body, authorName) {
      if (!uuid(recordId)) fail(400, '기록을 확인해 주세요.');
      const newPhotos = photoInput(body?.photos);
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'edit');
        const student = await studentOf(tx, school, accountId);
        await tx.q("SELECT pg_advisory_xact_lock(hashtext('job-record-revise'), hashtext($1))", [recordId]);
        const original = await tx.one('SELECT * FROM career_log.records WHERE id = $1 AND student_id = $2', [recordId, student.career_student_id]);
        if (!original) fail(404, '기록을 찾을 수 없습니다.');
        if (await tx.one('SELECT 1 FROM career_log.records WHERE student_id = $1 AND supersedes_id = $2', [student.career_student_id, recordId])) fail(409, '이미 정정된 기록입니다. 최신 내용을 다시 불러온 뒤 수정하세요.');
        const raw = original.raw_data && typeof original.raw_data === 'object' ? original.raw_data : {};
        const previousJob = raw.job && typeof raw.job === 'object' ? raw.job : {};
        // 진로 관찰 기록은 정정할 때도 관찰 항목 이름으로 받는다. 정정본의 entry_kind 는 'revision' 이라 원래 종류를 따로 본다.
        const kind = (previousJob.observation_kind || previousJob.entry_kind) === 'career_observation' ? 'career_observation' : 'staff_record';
        // 사진은 진로 관찰 기록에만 붙는다 — addRecord 와 같은 규칙을 정정에도 적용한다.
        if (newPhotos.length && kind !== 'career_observation') fail(400, '활동 사진은 진로 관찰 기록에만 넣을 수 있습니다.');
        const input = recordInput(body, { kind });
        // 사진은 원본에 그대로 남고, 남길 것으로 고른 것만 새 버전에 복사한다. keep 목록이 없으면 전부 이어간다.
        // 이어받는 장수 + 새로 넣는 장수가 한 기록 상한을 넘으면 안 된다 (새 사진만 세면 상한을 넘겨 버린다).
        const keep = Array.isArray(body?.keep_photo_ids) ? body.keep_photo_ids.filter(uuid) : null;
        const carried = await tx.q(`SELECT id FROM career_record_photos WHERE record_id = $1 ${keep ? 'AND id = ANY($2::uuid[])' : ''}`,
          keep ? [recordId, keep] : [recordId]);
        if (carried.length + newPhotos.length > MAX_PHOTOS) {
          fail(400, `사진은 한 기록에 최대 ${MAX_PHOTOS}장까지입니다. 남길 사진을 줄이거나 새로 넣을 사진을 빼 주세요.`);
        }
        const job = { ...previousJob, entry_kind: 'revision', revised_by: actor(user), author_name: authorName, original_source: original.source, school_id: school };
        if (kind === 'career_observation') { job.observation = input.observation; job.observation_kind = 'career_observation'; }
        if (input.title) job.title = input.title;
        const saved = await tx.one(`INSERT INTO career_log.records
            (student_id, session_ref, program_ref, occurred_at, process, artifact, reflection, source, verification_status, verified_by, verified_at, raw_data, source_event_id, supersedes_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'job', NULL, NULL, NULL, $8::jsonb, $9, $10) RETURNING id`,
        [student.career_student_id, original.session_ref, original.program_ref, input.occurredAt || original.occurred_at, input.process, input.artifact || null, input.reflection || null,
          JSON.stringify({ ...raw, job }), `job-revision:${recordId}:${crypto.randomUUID()}`, recordId]);
        await tx.q(`INSERT INTO career_record_photos (record_id, student_uuid, school_id, mime, data, caption, position, created_by)
          SELECT $1, student_uuid, school_id, mime, data, caption, position, created_by FROM career_record_photos
          WHERE record_id = $2 ${keep ? 'AND id = ANY($3::uuid[])' : ''} ORDER BY position, created_at`,
        keep ? [saved.id, recordId, keep] : [saved.id, recordId]);
        const offset = (await tx.one('SELECT COALESCE(max(position), -1) + 1 AS next FROM career_record_photos WHERE record_id = $1', [saved.id])).next;
        await insertPhotos(tx, { recordId: saved.id, studentUuid: student.career_student_id, school, author: actor(user),
          photos: newPhotos.map(photo => ({ ...photo, position: photo.position + Number(offset) })) });
        await audit(tx, user, school, 'record_revised', student.id);
        return { id: saved.id, supersedes: recordId };
      });
    },
    // 담당자가 학생 기록을 새로 남긴다 (기관 수업·상담 등).
    async addRecord(user, school, accountId, body, authorName) {
      const kind = body?.kind === 'career_observation' ? 'career_observation' : 'staff_record';
      const input = recordInput(body, { requireTitle: true, kind });
      const photos = photoInput(body?.photos);
      if (photos.length && kind !== 'career_observation') fail(400, '활동 사진은 진로 관찰 기록에만 넣을 수 있습니다.');
      return withTransaction(async tx => {
        await authorizeRecords(tx, user, school, 'edit');
        const student = await studentOf(tx, school, accountId);
        const schoolRow = await tx.one('SELECT name FROM moakit_accounts.schools WHERE id = $1', [school]);
        const job = { entry_kind: kind, title: input.title, author: actor(user), author_name: authorName, school_id: school, school_name: schoolRow?.name || '', session_title: input.title };
        if (kind === 'career_observation') { job.observation = input.observation; job.observation_kind = kind; }
        const saved = await tx.one(`INSERT INTO career_log.records
            (student_id, session_ref, program_ref, occurred_at, process, artifact, reflection, source, verification_status, verified_by, verified_at, raw_data, source_event_id, supersedes_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'job', NULL, NULL, NULL, $8::jsonb, $9, NULL) RETURNING id`,
        [student.career_student_id, `job-school:${school}`, kind === 'career_observation' ? 'job-career-observation' : 'job-staff-record',
          input.occurredAt || new Date().toISOString(), input.process, input.artifact || null, input.reflection || null,
          JSON.stringify({ job }), `job-staff:${student.career_student_id}:${crypto.randomUUID()}`]);
        await insertPhotos(tx, { recordId: saved.id, studentUuid: student.career_student_id, school, photos, author: actor(user) });
        await audit(tx, user, school, photos.length ? `record_added:photos=${photos.length}` : 'record_added', student.id);
        return { id: saved.id, photos: photos.length };
      });
    },

    // 활동 사진 한 장. 기록 열람 권한이 있는 학교의 사진만 연다 (학생 본인 확인은 lib/api.js 쪽에서 한다).
    async photo(user, photoId) {
      if (!uuid(photoId)) fail(404, '사진을 찾을 수 없습니다.');
      return withTransaction(async tx => {
        const row = await tx.one('SELECT id, student_uuid, school_id, mime, data FROM career_record_photos WHERE id = $1', [photoId]);
        if (!row) fail(404, '사진을 찾을 수 없습니다.');
        if (!(await recordLevel(tx, user, row.school_id))) fail(403, '이 사진을 볼 권한이 없습니다.');
        return row;
      });
    },
    // 학생 본인용: 자기 학생 번호의 사진만 연다.
    async photoForStudent(studentUuid, photoId) {
      if (!uuid(photoId) || !uuid(studentUuid)) fail(404, '사진을 찾을 수 없습니다.');
      return withTransaction(async tx => {
        const row = await tx.one('SELECT id, student_uuid, mime, data FROM career_record_photos WHERE id = $1 AND student_uuid = $2', [photoId, studentUuid]);
        if (!row) fail(404, '사진을 찾을 수 없습니다.');
        return row;
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
