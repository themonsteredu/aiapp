'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSchoolRegistry, ISSUER } = require('../lib/school-registry');
const { passwordMatches } = require('../lib/school-accounts');

const roles = { student: 0, instructor: 1, admin: 2, superadmin: 3 };
const roleLevel = role => roles[role] ?? -1;
const school = crypto.randomUUID();
const admin = { id: 1, role: 'admin' }, instructor = { id: 5, role: 'instructor' }, student = { id: 9, role: 'student' };

// managers · school_access · memberships 를 흉내 내는 아주 작은 DB
function fixture({ managers = [], access = [], members = [] } = {}) {
  const calls = [], accounts = [];
  let inTx = 0;
  async function q(sql, values = []) {
    calls.push({ sql, values });
    if (sql.startsWith('INSERT INTO moakit_accounts.school_access')) { access.push({ school: values[0], issuer: values[1] }); return []; }
    if (sql.startsWith('DELETE FROM moakit_accounts.school_access')) { const i = access.findIndex(a => a.school === values[0] && a.issuer === values[1]); if (i >= 0) access.splice(i, 1); return []; }
    if (sql.includes('FROM moakit_accounts.managers')) return managers.some(m => m.school === values[0] && m.issuer === values[1] && m.teacher === values[2]) ? [{ ok: 1 }] : [];
    if (sql.includes('FROM moakit_accounts.school_access')) return access.some(a => a.school === values[0] && a.issuer === values[1]) ? [{ ok: 1 }] : [];
    if (sql.startsWith('INSERT INTO moakit_accounts.schools')) return [{ id: crypto.randomUUID(), name: values[0] }];
    if (sql.startsWith('INSERT INTO moakit_accounts.managers')) { managers.push({ school: values[0], issuer: values[1], teacher: values[2] }); return []; }
    if (sql.includes('FROM moakit_accounts.memberships WHERE school_id')) return members.map(m => ({ account_id: m.id, class_name: m.class_name }));
    if (sql.startsWith('INSERT INTO moakit_accounts.accounts')) { const id = crypto.randomUUID(); accounts.push({ id, career_student_id: values[0], username: values[1], password_hash: values[2] }); return [{ id }]; }
    if (sql.startsWith('SELECT s.id, s.name')) return [];
    return [];
  }
  const one = async (sql, values) => (await q(sql, values))[0] || null;
  const withTransaction = async work => { inTx += 1; try { return await work({ q, one }); } finally { inTx -= 1; } };
  return { registry: createSchoolRegistry({ withTransaction, roleLevel }), calls, accounts, managers, access };
}
const rejects = (p, status) => assert.rejects(p, e => { assert.equal(e.status, status); return true; });

test('담당자가 아니고 열린 학교도 아니면 목록·발급·초기화 모두 거절하고 아무것도 쓰지 않는다', async () => {
  const f = fixture();
  await rejects(f.registry.list(instructor, school), 403);
  await rejects(f.registry.provision(instructor, school, [{ displayName: '학생', className: '1반' }]), 403);
  await rejects(f.registry.reset(admin, school, crypto.randomUUID()), 403);
  await rejects(f.registry.list(student, school), 403);
  assert.equal(f.calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql)), false);
});

test('모아허브가 모아랩에 열어 준 학교는 관리자만 담당 지정 없이 관리한다', async () => {
  const f = fixture({ access: [{ school, issuer: ISSUER }] });
  assert.deepEqual(await f.registry.list(admin, school), []);
  await rejects(f.registry.list(instructor, school), 403);
});

test('발급은 학생마다 독립된 UUID·아이디·scrypt1 비밀번호를 만들고 감사 기록을 남긴다', async () => {
  const f = fixture({ managers: [{ school, issuer: ISSUER, teacher: '5' }] });
  const issued = await f.registry.provision(instructor, school, [{ displayName: '김모아', grade: 2, classNumber: 1, studentNumber: 3 }, { displayName: '김모아', grade: 2, classNumber: 1, studentNumber: 4 }]);
  assert.equal(issued.length, 2);
  assert.notEqual(issued[0].username, issued[1].username);
  assert.match(issued[0].username, /^m[a-f0-9]{20}$/);
  assert.equal(issued[0].className, '2학년 1반 3번');
  const students = f.calls.filter(c => c.sql.startsWith('INSERT INTO career_log.students')).map(c => c.values[0]);
  assert.equal(new Set(students).size, 2);
  assert.equal(await passwordMatches(issued[0].temporaryPassword, f.accounts[0].password_hash), true);
  assert.equal(f.calls.filter(c => c.sql.startsWith('INSERT INTO moakit_accounts.audit') && c.values[2] === 'account_issued').length, 2);
  assert.ok(f.calls.some(c => c.sql.includes('pg_advisory_xact_lock')), '같은 학교 명단 잠금');
  assert.ok(f.calls.every(c => !c.values.includes(issued[0].temporaryPassword)), '임시 비밀번호 원문은 DB에 가지 않는다');
});

test('이미 있는 자리(학년·반·번호)는 409, 같은 명단 안의 중복은 400', async () => {
  const f = fixture({ managers: [{ school, issuer: ISSUER, teacher: '5' }], members: [{ id: crypto.randomUUID(), class_name: '2학년 1반 3번' }] });
  await rejects(f.registry.provision(instructor, school, [{ displayName: '다른 학생', grade: 2, classNumber: 1, studentNumber: 3 }]), 409);
  await rejects(f.registry.provision(instructor, school, [{ displayName: 'a', grade: 1, classNumber: 1, studentNumber: 1 }, { displayName: 'b', grade: 1, classNumber: 1, studentNumber: 1 }]), 400);
});

test('학교 등록·담당 지정·모아허브에 열기는 관리자만, 대상 제품을 확인한다', async () => {
  const f = fixture();
  await rejects(f.registry.createSchool(instructor, '모아초'), 403);
  const created = await f.registry.createSchool(admin, '모아초등학교');
  assert.ok(f.managers.some(m => m.school === created.id && m.issuer === ISSUER && m.teacher === '1'));
  await rejects(f.registry.setAccess(instructor, created.id, 'moakit-hub', true), 403);
  await rejects(f.registry.setAccess(admin, created.id, 'moakit-lab', true), 400);
  await rejects(f.registry.setAccess(admin, created.id, 'evil', true), 400);
  await f.registry.setAccess(admin, created.id, 'moakit-hub', true);
  assert.ok(f.access.some(a => a.school === created.id && a.issuer === 'moakit-hub'));
  assert.ok(f.calls.some(c => c.sql.startsWith('INSERT INTO moakit_accounts.audit') && c.values[2] === 'access_opened:moakit-hub' && c.values[1] === 'moakit-lab:1'));
  await f.registry.setAccess(admin, created.id, 'moakit-hub', false);
  assert.equal(f.access.some(a => a.issuer === 'moakit-hub'), false);
  await rejects(f.registry.grantManager(instructor, created.id, '7'), 403);
  await f.registry.grantManager(admin, created.id, '7');
  assert.ok(f.managers.some(m => m.school === created.id && m.teacher === '7'));
});

// ---- 진로기록 열람·수정 권한 ----
function recordFixture() {
  const calls = [], schools = [{ id: school, name: '모아초등학교' }, { id: crypto.randomUUID(), name: '나래중학교' }];
  const access = [], records = [], photos = [];
  const decks = [{ id: 7, title: '디지털 포렌식 웹앱' }, { id: 8, title: '항공 관제 웹앱' }];
  const account = { id: crypto.randomUUID(), username: 'mabc', career_student_id: crypto.randomUUID(), display_name: '김모아', class_name: '2학년 1반 3번' };
  const hubRecord = { id: crypto.randomUUID(), student_id: account.career_student_id, session_ref: 'hub-board:1', program_ref: 'science-observation-ai-03', occurred_at: '2026-09-05T00:00:00Z', process: '민들레 관찰', artifact: null, reflection: null, source: 'hub', raw_data: { hub: { board_id: '1' } }, supersedes_id: null };
  records.push(hubRecord);
  async function q(sql, values = []) {
    calls.push({ sql, values });
    if (sql.includes('FROM moakit_accounts.schools WHERE id')) return schools.some(s => s.id === values[0]) ? [{ ok: 1 }] : [];
    if (sql.startsWith('SELECT id, name FROM moakit_accounts.schools')) return schools;
    if (sql.startsWith('SELECT name FROM moakit_accounts.schools')) return [{ name: '모아초등학교' }];
    if (sql.includes('FROM moakit_accounts.record_access v JOIN')) return access.filter(a => a.user === values[1]).map(a => ({ id: a.school, name: schools.find(s => s.id === a.school).name, level: a.level }));
    if (sql.startsWith('SELECT level FROM moakit_accounts.record_access')) { const a = access.find(a => a.school === values[0] && a.user === values[2]); return a ? [{ level: a.level }] : []; }
    if (sql.startsWith('SELECT 1 FROM moakit_accounts.record_access')) return access.some(a => a.user === values[1]) ? [{ ok: 1 }] : [];
    if (sql.startsWith('INSERT INTO moakit_accounts.record_access')) { const i = access.findIndex(a => a.school === values[0] && a.user === values[2]); const row = { school: values[0], user: values[2], level: values[3] }; if (i >= 0) access[i] = row; else access.push(row); return []; }
    if (sql.startsWith('DELETE FROM moakit_accounts.record_access')) { const i = access.findIndex(a => a.school === values[0] && a.user === values[2]); if (i >= 0) access.splice(i, 1); return []; }
    if (sql.includes('FROM moakit_accounts.managers')) return [];
    if (sql.includes('FROM moakit_accounts.school_access')) return [];
    if (sql.includes('JOIN moakit_accounts.memberships m') && sql.includes('WHERE a.id = $1')) return values[0] === account.id && values[1] === school ? [account] : [];
    if (sql.includes('FROM moakit_accounts.memberships m JOIN moakit_accounts.accounts a')) return [account];
    if (sql.includes('pg_advisory_xact_lock')) return [];
    if (sql.startsWith('SELECT mime, caption, md5(data) AS digest FROM career_record_photos')) {
      const keep = values[1] || null;
      return photos.filter(p => p.record_id === values[0] && (!keep || keep.includes(p.id))).sort((a, b) => a.position - b.position)
        .map(p => ({ mime: p.mime, caption: p.caption, digest: crypto.createHash('md5').update(p.data).digest('hex') }));
    }
    if (sql.startsWith('SELECT id, raw_data FROM career_log.records WHERE id')) return records.filter(r => r.id === values[0] && r.student_id === values[1]);
    if (sql.startsWith('SELECT id FROM career_record_photos WHERE record_id')) {
      const keep = values[1] || null;
      return photos.filter(p => p.record_id === values[0] && (!keep || keep.includes(p.id)));
    }
    if (sql.startsWith('SELECT id, record_id, mime, caption, position FROM career_record_photos')) {
      return photos.filter(p => values[0].includes(p.record_id)).sort((a, b) => a.position - b.position);
    }
    if (sql.startsWith('SELECT COALESCE(max(position)')) {
      const mine = photos.filter(p => p.record_id === values[0]);
      return [{ next: mine.length ? Math.max(...mine.map(p => p.position)) + 1 : 0 }];
    }
    if (sql.includes('INSERT INTO career_record_photos') && sql.includes('SELECT $1')) {
      const keep = values[2] || null;
      for (const p of photos.filter(p => p.record_id === values[1] && (!keep || keep.includes(p.id))).sort((a, b) => a.position - b.position)) {
        photos.push({ ...p, id: crypto.randomUUID(), record_id: values[0] });
      }
      return [];
    }
    if (sql.startsWith('INSERT INTO career_record_photos')) {
      photos.push({ id: crypto.randomUUID(), record_id: values[0], student_uuid: values[1], school_id: values[2], mime: values[3], data: values[4], caption: values[5], position: values[6], created_by: values[7] });
      return [];
    }
    if (sql.includes('FROM career_record_photos WHERE id = $1 AND student_uuid')) return photos.filter(p => p.id === values[0] && p.student_uuid === values[1]);
    if (sql.includes('FROM career_record_photos WHERE id = $1')) return photos.filter(p => p.id === values[0]);
    if (sql.startsWith('INSERT INTO moakit_accounts.audit')) return [];
    if (sql.includes('WHERE r.student_id = $1 AND NOT EXISTS')) return records.filter(r => r.student_id === values[0] && !records.some(n => n.supersedes_id === r.id)).map(r => ({ ...r, title: r.raw_data.job?.title || '', entry_kind: r.raw_data.job?.entry_kind || null, observation: r.raw_data.job?.observation || null }));
    if (sql.startsWith('SELECT * FROM career_log.records WHERE id')) return records.filter(r => r.id === values[0] && r.student_id === values[1]);
    if (sql.startsWith('SELECT 1 FROM career_log.records WHERE student_id = $1 AND supersedes_id')) return records.some(r => r.supersedes_id === values[1]) ? [{ ok: 1 }] : [];
    if (sql.startsWith('SELECT id, title FROM decks WHERE id = $1')) return decks.filter(d => d.id === values[0]);
    if (sql.startsWith('SELECT 1 FROM career_log.records WHERE student_id = $1 AND program_ref = $2')) return records.some(r => r.student_id === values[0] && r.program_ref === values[1]) ? [{ ok: 1 }] : [];
    if (sql.includes('FROM career_log.records') && sql.includes('source_event_id = $1 AND student_id = $2')) {
      return records.filter(r => r.source === 'job' && r.source_event_id === values[0] && r.student_id === values[1] && (!sql.includes('supersedes_id = $3') || r.supersedes_id === values[2]));
    }
    if (sql.startsWith('INSERT INTO career_log.records')) {
      if (records.some(r => r.source === 'job' && r.source_event_id === values[8])) throw new Error('duplicate source_event_id');
      const r = { id: crypto.randomUUID(), student_id: values[0], session_ref: values[1], program_ref: values[2], occurred_at: values[3], process: values[4], artifact: values[5], reflection: values[6], source: 'job', raw_data: JSON.parse(values[7]), source_event_id: values[8], supersedes_id: values[9] ?? null };
      records.push(r); return [{ id: r.id }];
    }
    if (sql.includes('WITH RECURSIVE chain') && sql.includes('root_author_name')) {
      let cur = records.find(r => r.id === values[0] && r.student_id === values[1]);
      while (cur && cur.supersedes_id) cur = records.find(r => r.id === cur.supersedes_id);
      return cur ? [{ root_author_name: cur.raw_data.job?.author_name ?? null }] : [];
    }
    if (sql.includes('WITH RECURSIVE chain')) { const out = []; let cur = records.find(r => r.id === values[0]); while (cur && cur.supersedes_id) { cur = records.find(r => r.id === cur.supersedes_id); if (cur) out.push(cur); } return out; }
    throw new Error('Unhandled: ' + sql.slice(0, 80));
  }
  const one = async (sql, values) => (await q(sql, values))[0] || null;
  const withTransaction = work => work({ q, one });
  return { registry: createSchoolRegistry({ withTransaction, roleLevel }), calls, access, records, photos, account, hubRecord, decks };
}
const sky = { id: 77, role: 'instructor', name: '스카이 담당자' };

test('관리자는 중앙의 모든 학교 기록을 열람·수정하고, 권한 없는 강사는 아무것도 못 본다', async () => {
  const f = recordFixture();
  assert.equal((await f.registry.recordSchools(admin)).length, 2);
  assert.equal(await f.registry.canViewRecords(admin), true);
  assert.equal(await f.registry.canViewRecords(sky), false);
  assert.deepEqual(await f.registry.recordSchools(sky), []);
  await rejects(f.registry.members(sky, school), 403);
  await rejects(f.registry.studentRecords(sky, school, f.account.id), 403);
  const data = await f.registry.studentRecords(admin, school, f.account.id);
  assert.equal(data.level, 'edit');
  assert.equal(data.records.length, 1);
  assert.ok(f.calls.some(c => c.sql.startsWith('INSERT INTO moakit_accounts.audit') && c.values[2] === 'records_viewed'), '열람은 감사 기록에 남는다');
});

test('열람 권한은 읽기만, 수정 권한은 정정·추가까지. 권한 부여는 관리자만', async () => {
  const f = recordFixture();
  await rejects(f.registry.setRecordAccess(sky, school, '77', 'edit'), 403);
  await rejects(f.registry.setRecordAccess(admin, school, '77', 'owner'), 400);
  await f.registry.setRecordAccess(admin, school, '77', 'view');
  assert.equal(await f.registry.canViewRecords(sky), true);
  assert.deepEqual((await f.registry.recordSchools(sky)).map(s => s.level), ['view']);
  assert.equal((await f.registry.members(sky, school)).students.length, 1);
  await rejects(f.registry.reviseRecord(sky, school, f.account.id, f.hubRecord.id, { process: '고침' }, '스카이'), 403);
  await rejects(f.registry.addRecord(sky, school, f.account.id, { title: '상담', process: '내용' }, '스카이'), 403);
  await f.registry.setRecordAccess(admin, school, '77', 'edit');
  const added = await f.registry.addRecord(sky, school, f.account.id, { title: '진로 상담 1회차', process: '흥미 검사 결과를 함께 읽음', occurred_at: '2026-09-10' }, '스카이');
  assert.ok(added.id);
  const staff = f.records.find(r => r.id === added.id);
  assert.equal(staff.program_ref, 'job-staff-record');
  assert.equal(staff.raw_data.job.entry_kind, 'staff_record');
  assert.equal(staff.raw_data.job.author, 'moakit-lab:77');
  await f.registry.setRecordAccess(admin, school, '77', null);
  assert.equal(await f.registry.canViewRecords(sky), false);
});

test('정정은 원본을 두고 새 버전을 잇고, 두 번째 정정은 최신 버전에만 된다', async () => {
  const f = recordFixture();
  const first = await f.registry.reviseRecord(admin, school, f.account.id, f.hubRecord.id, { process: '민들레와 토끼풀을 비교 관찰', reflection: '잎 모양이 다르다' }, '관리자');
  assert.equal(first.supersedes, f.hubRecord.id);
  const revised = f.records.find(r => r.id === first.id);
  assert.equal(revised.supersedes_id, f.hubRecord.id);
  assert.equal(revised.program_ref, f.hubRecord.program_ref, '수업·프로그램 정보는 원본을 따른다');
  assert.equal(revised.raw_data.job.entry_kind, 'revision');
  assert.equal(revised.raw_data.job.original_source, 'hub');
  assert.ok(f.records.some(r => r.id === f.hubRecord.id), '원본은 지워지지 않는다');
  assert.equal(f.calls.some(c => /^(UPDATE|DELETE) /.test(c.sql) && c.sql.includes('career_log.records')), false, '원본 UPDATE/DELETE 없음');
  const list = await f.registry.studentRecords(admin, school, f.account.id);
  assert.deepEqual(list.records.map(r => r.id), [first.id], '최신 버전만 보인다');
  await rejects(f.registry.reviseRecord(admin, school, f.account.id, f.hubRecord.id, { process: '또 고침' }, '관리자'), 409);
  const history = await f.registry.recordHistory(admin, school, f.account.id, first.id);
  assert.deepEqual(history.history.map(h => h.id), [f.hubRecord.id]);
  await rejects(f.registry.reviseRecord(admin, school, f.account.id, first.id, { process: '' }, '관리자'), 400);
});

// ---- 진로 관찰 기록 + 활동 사진 ----
const partner = { id: 91, role: 'partner', name: '스카이 진로업체' };
const jpeg = caption => ({ data: `data:image/jpeg;base64,${'A'.repeat(120)}`, caption });

test('진로업체 담당자는 권한을 받은 학교만 보고, 학교·계정 관리에는 닿지 못한다', async () => {
  const f = recordFixture();
  assert.equal(await f.registry.canViewRecords(partner), false);
  await rejects(f.registry.studentRecords(partner, school, f.account.id), 403);
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  assert.equal(await f.registry.canViewRecords(partner), true);
  assert.deepEqual((await f.registry.recordSchools(partner)).map(s => s.name), ['모아초등학교'], '권한 받은 학교만');
  assert.equal((await f.registry.members(partner, school)).level, 'edit');
  // 학교 등록·계정 발급·권한 부여는 여전히 관리자 몫이다.
  await rejects(f.registry.createSchool(partner, '남의 학교'), 403);
  await rejects(f.registry.schools(partner), 403);
  await rejects(f.registry.setRecordAccess(partner, school, '92', 'edit'), 403);
  await rejects(f.registry.grantManager(partner, school, '92'), 403);
});

test('진로 관찰 기록은 관찰 항목과 사진을 함께 남기고, 학생 목록에 최신 버전으로 나온다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const added = await f.registry.addRecord(partner, school, f.account.id, {
    kind: 'career_observation', title: '항공 진로 체험 2회차', occurred_at: '2026-09-11',
    activity: '관제 시뮬레이터를 직접 조작했습니다.', strengths: '순서를 정리해 설명하는 힘이 좋습니다.', next_step: '공항 견학 프로그램을 권합니다.',
    photos: [jpeg('시뮬레이터 실습'), jpeg('')],
  }, '스카이 진로업체');
  assert.equal(added.photos, 2);
  const saved = f.records.find(r => r.id === added.id);
  assert.equal(saved.program_ref, 'job-career-observation');
  assert.equal(saved.raw_data.job.entry_kind, 'career_observation');
  assert.equal(saved.raw_data.job.author, 'moakit-lab:91');
  assert.deepEqual(saved.raw_data.job.observation, {
    activity: '관제 시뮬레이터를 직접 조작했습니다.', strengths: '순서를 정리해 설명하는 힘이 좋습니다.', next_step: '공항 견학 프로그램을 권합니다.',
  });
  // 관찰 항목은 원래 칸에도 들어가 학생 본인 화면·모아허브가 그대로 읽는다.
  assert.equal(saved.process, '관제 시뮬레이터를 직접 조작했습니다.');
  assert.equal(saved.artifact, '순서를 정리해 설명하는 힘이 좋습니다.');
  assert.equal(saved.reflection, '공항 견학 프로그램을 권합니다.');

  const list = await f.registry.studentRecords(partner, school, f.account.id);
  const card = list.records.find(r => r.id === added.id);
  assert.equal(card.photos.length, 2);
  assert.equal(card.photos[0].caption, '시뮬레이터 실습');
  assert.equal(card.photos[0].data, undefined, '목록에는 사진 바이트를 내려보내지 않는다');
});

test('관찰 기록을 정정하면 고른 사진만 새 버전으로 이어지고 원본은 그대로 남는다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const added = await f.registry.addRecord(partner, school, f.account.id, {
    kind: 'career_observation', title: '체험 1회차', activity: '처음 기록', photos: [jpeg('첫 장'), jpeg('둘째 장')],
  }, '스카이');
  const original = f.photos.filter(p => p.record_id === added.id);
  const revised = await f.registry.reviseRecord(partner, school, f.account.id, added.id, {
    activity: '고친 기록', strengths: '관찰 내용을 보탰습니다.',
    keep_photo_ids: [original[0].id], photos: [jpeg('정정하며 추가')],
  }, '스카이');
  const next = f.records.find(r => r.id === revised.id);
  assert.equal(next.raw_data.job.entry_kind, 'revision');
  assert.equal(next.raw_data.job.observation_kind, 'career_observation', '정정본도 관찰 기록으로 읽힌다');
  assert.equal(next.raw_data.job.observation.activity, '고친 기록');
  assert.equal(next.process, '고친 기록');
  assert.equal(f.photos.filter(p => p.record_id === added.id).length, 2, '원본의 사진은 그대로');
  const carried = f.photos.filter(p => p.record_id === revised.id);
  assert.deepEqual(carried.map(p => p.caption), ['첫 장', '정정하며 추가'], '남기기로 고른 사진 + 새 사진');
  const history = await f.registry.recordHistory(partner, school, f.account.id, revised.id);
  assert.equal(history.history[0].photos.length, 2, '이전 버전에는 뺀 사진도 남아 있다');
});

test('사진은 이미지 형식·장수·용량을 넘기면 저장되지 않는다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const base = { kind: 'career_observation', title: '체험', activity: '내용' };
  await rejects(f.registry.addRecord(partner, school, f.account.id, { ...base, photos: [{ data: 'data:application/pdf;base64,AAAA' }] }, '스카이'), 400);
  await rejects(f.registry.addRecord(partner, school, f.account.id, { ...base, photos: [{ data: 'https://example.com/a.jpg' }] }, '스카이'), 400);
  await rejects(f.registry.addRecord(partner, school, f.account.id, { ...base, photos: Array.from({ length: 7 }, () => jpeg('')) }, '스카이'), 400);
  await rejects(f.registry.addRecord(partner, school, f.account.id, { ...base, photos: [{ data: `data:image/jpeg;base64,${'A'.repeat(900_001)}` }] }, '스카이'), 400);
  // Vercel 요청 본문 한도(4.5MB) 때문에 한 요청의 사진 합계도 막는다 — 장당 한도만으로는 부족하다.
  const big = () => ({ data: `data:image/jpeg;base64,${'A'.repeat(880_000)}` });
  await rejects(f.registry.addRecord(partner, school, f.account.id, { ...base, photos: [big(), big(), big(), big()] }, '스카이'), 400);
  await f.registry.addRecord(partner, school, f.account.id, { ...base, photos: [big(), big(), big()] }, '스카이');
  assert.equal(f.photos.length, 3, '합계 안에 들면 저장된다');
  // 일반 담당자 기록에는 사진을 붙일 수 없다.
  await rejects(f.registry.addRecord(partner, school, f.account.id, { title: '상담', process: '내용', photos: [jpeg('')] }, '스카이'), 400);
  // 제목과 활동 모습은 필수다.
  await rejects(f.registry.addRecord(partner, school, f.account.id, { kind: 'career_observation', title: '체험', activity: '' }, '스카이'), 400);
});

test('정정도 사진 규칙을 그대로 지킨다 — 종류와 이어받은 장수까지 센다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const full = await f.registry.addRecord(partner, school, f.account.id, {
    kind: 'career_observation', title: '체험', activity: '내용',
    photos: Array.from({ length: 6 }, (_, i) => jpeg(`사진${i}`)),
  }, '스카이');
  // 6장을 그대로 남기고 한 장 더 넣으면 상한을 넘는다 (새 사진만 세면 통과해 버린다).
  await rejects(f.registry.reviseRecord(partner, school, f.account.id, full.id, { activity: '고침', photos: [jpeg('일곱째')] }, '스카이'), 400);
  assert.equal(f.photos.length, 6, '막힌 정정은 사진을 남기지 않는다');
  // 두 장을 빼면 들어간다.
  const keep = f.photos.filter(p => p.record_id === full.id).slice(0, 4).map(p => p.id);
  const revised = await f.registry.reviseRecord(partner, school, f.account.id, full.id, { activity: '고침', keep_photo_ids: keep, photos: [jpeg('다섯째')] }, '스카이');
  assert.equal(f.photos.filter(p => p.record_id === revised.id).length, 5);
  // 일반 담당자 기록에는 정정할 때도 사진을 못 붙인다 (addRecord 와 같은 규칙).
  const staffRecord = await f.registry.addRecord(partner, school, f.account.id, { title: '상담', process: '내용' }, '스카이');
  await rejects(f.registry.reviseRecord(partner, school, f.account.id, staffRecord.id, { process: '고침', photos: [jpeg('몰래')] }, '스카이'), 400);
  assert.equal(f.photos.some(p => p.caption === '몰래'), false);
  // 학교 수업 기록(hub)을 정정할 때도 마찬가지다.
  await rejects(f.registry.reviseRecord(partner, school, f.account.id, f.hubRecord.id, { process: '고침', photos: [jpeg('몰래2')] }, '스카이'), 400);
  assert.equal(f.photos.some(p => p.caption === '몰래2'), false);
});

test('사진은 기록 권한이 있는 학교만, 학생은 자기 번호의 것만 열 수 있다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const added = await f.registry.addRecord(partner, school, f.account.id, {
    kind: 'career_observation', title: '체험', activity: '내용', photos: [jpeg('한 장')],
  }, '스카이');
  const photo = f.photos.find(p => p.record_id === added.id);
  assert.equal((await f.registry.photo(admin, photo.id)).mime, 'image/jpeg');
  assert.equal((await f.registry.photo(partner, photo.id)).id, photo.id);
  await rejects(f.registry.photo(sky, photo.id), 403, '권한 없는 강사는 못 본다');
  await f.registry.setRecordAccess(admin, school, '91', null);
  await rejects(f.registry.photo(partner, photo.id), 403, '권한을 거두면 사진도 닫힌다');
  assert.equal((await f.registry.photoForStudent(f.account.career_student_id, photo.id)).id, photo.id);
  await rejects(f.registry.photoForStudent(crypto.randomUUID(), photo.id), 404, '다른 학생 번호로는 못 연다');
  await rejects(f.registry.photo(admin, 'not-a-uuid'), 404);
});

// ---- 관찰 기록을 웹앱 활동에 잇기 ----
// 학생이 웹앱(덱)에서 직접 남긴 기록. lib/career-log.js 가 저장하는 모양과 같다.
function studentDeckRecord(f, deckId, title) {
  const r = { id: crypto.randomUUID(), student_id: f.account.career_student_id, session_ref: `job-account-deck:${deckId}`, program_ref: `job-deck:${deckId}`, occurred_at: '2026-09-12T01:00:00Z', process: '웹앱에서 증거를 비교했다', artifact: null, reflection: '첫 판단을 고쳤다', source: 'job', raw_data: { job: { deck_id: deckId, deck_title: title, entry_kind: 'student_reflection' } }, source_event_id: `job:${f.account.career_student_id}:${crypto.randomUUID()}`, supersedes_id: null };
  f.records.push(r);
  return r;
}
const observe = extra => ({ kind: 'career_observation', title: '포렌식 웹앱 관찰', activity: '증거를 순서대로 비교했습니다.', strengths: '근거를 꼼꼼히 봅니다.', ...extra });
const inserts = f => f.calls.filter(c => c.sql.startsWith('INSERT INTO career_log.records')).length;
const audits = (f, prefix) => f.calls.filter(c => c.sql.startsWith('INSERT INTO moakit_accounts.audit') && String(c.values[2]).startsWith(prefix)).length;

test('관찰 기록에 웹앱을 이으면 서버의 웹앱 제목을 남기고 관찰 기록 표시는 그대로 둔다', async () => {
  const f = recordFixture();
  const added = await f.registry.addRecord(admin, school, f.account.id, observe({ deck_id: 8, deck_title: '꾸민 제목' }), '관리자');
  const saved = f.records.find(r => r.id === added.id);
  assert.equal(saved.raw_data.job.deck_id, 8);
  assert.equal(saved.raw_data.job.deck_title, '항공 관제 웹앱', '제목은 클라이언트 값이 아니라 decks 에서 읽는다');
  assert.equal(saved.program_ref, 'job-career-observation', '모아허브 observationOf 가 기대하는 값 유지');
  assert.equal(saved.session_ref, `job-school:${school}`);
  assert.equal(saved.raw_data.job.entry_kind, 'career_observation');
  // 관리자는 학생이 쓰지 않은 웹앱도 이을 수 있다 (8번은 이 학생 기록에 없다).
  assert.equal(f.records.some(r => r.program_ref === 'job-deck:8'), false);
  // 목록 응답에 deck_id·deck_title 이 실린다.
  await f.registry.studentRecords(admin, school, f.account.id);
  const listSql = f.calls.findLast(c => c.sql.includes('WHERE r.student_id = $1 AND NOT EXISTS')).sql;
  assert.match(listSql, /'deck_id' AS deck_id/);
  assert.match(listSql, /'deck_title' AS deck_title/);
});

test('없는 웹앱·잘못된 번호는 저장하지 않는다', async () => {
  const f = recordFixture();
  await rejects(f.registry.addRecord(admin, school, f.account.id, observe({ deck_id: 999 }), '관리자'), 404);
  for (const deck_id of ['7', -1, 0, 1.5, 2 ** 60]) {
    await rejects(f.registry.addRecord(admin, school, f.account.id, observe({ deck_id }), '관리자'), 400);
  }
  assert.equal(inserts(f), 0);
  // 비워 두면 연결하지 않은 관찰 기록이 된다.
  const plain = await f.registry.addRecord(admin, school, f.account.id, observe({ deck_id: '' }), '관리자');
  assert.equal(f.records.find(r => r.id === plain.id).raw_data.job.deck_id, undefined);
});

test('진로업체 담당자는 이 학생이 실제로 활동한 웹앱만 이을 수 있다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  await rejects(f.registry.addRecord(partner, school, f.account.id, observe({ deck_id: 7 }), '스카이'), 403);
  assert.equal(inserts(f), 0, '막힌 요청은 아무것도 남기지 않는다');
  studentDeckRecord(f, 7, '디지털 포렌식 웹앱');
  const added = await f.registry.addRecord(partner, school, f.account.id, observe({ deck_id: 7 }), '스카이');
  assert.equal(f.records.find(r => r.id === added.id).raw_data.job.deck_title, '디지털 포렌식 웹앱');
  // 다른 웹앱(8번)은 여전히 안 된다.
  await rejects(f.registry.addRecord(partner, school, f.account.id, observe({ deck_id: 8 }), '스카이'), 403);
});

test('같은 attempt_id 로 다시 보낸 저장은 새 기록·사진·감사 기록 없이 처음 접수번호를 돌려준다', async () => {
  const f = recordFixture();
  const attempt_id = crypto.randomUUID();
  const body = observe({ deck_id: 8, attempt_id, photos: [jpeg('한 장')] });
  const first = await f.registry.addRecord(admin, school, f.account.id, body, '관리자');
  assert.equal(first.duplicate, undefined);
  assert.equal(f.records.find(r => r.id === first.id).source_event_id, `job-staff:${f.account.career_student_id}:${attempt_id}`);
  const again = await f.registry.addRecord(admin, school, f.account.id, { ...body, attempt_id: attempt_id.toUpperCase() }, '관리자');
  assert.deepEqual(again, { id: first.id, photos: 1, duplicate: true }, '처음 저장한 사진 장수를 그대로 알려 준다');
  assert.equal(inserts(f), 1, '기록은 하나만');
  assert.equal(f.photos.length, 1, '사진도 한 번만');
  assert.equal(audits(f, 'record_added'), 1, '감사 기록도 한 번만');
  assert.ok(f.calls.some(c => c.sql.includes("hashtext('job-staff-record')")), '같은 시도 번호는 잠그고 확인한다');
});

test('같은 attempt_id 에 내용이 다르면 409 로 막고 원래 기록을 덮지 않는다', async () => {
  const f = recordFixture();
  const attempt_id = crypto.randomUUID();
  const first = await f.registry.addRecord(admin, school, f.account.id, observe({ attempt_id }), '관리자');
  await rejects(f.registry.addRecord(admin, school, f.account.id, observe({ attempt_id, activity: '바뀐 내용' }), '관리자'), 409);
  await rejects(f.registry.addRecord(admin, school, f.account.id, observe({ attempt_id, deck_id: 8 }), '관리자'), 409);
  await rejects(f.registry.addRecord(admin, school, f.account.id, { attempt_id, title: '포렌식 웹앱 관찰', process: '증거를 순서대로 비교했습니다.', artifact: '근거를 꼼꼼히 봅니다.' }, '관리자'), 409, '종류가 달라도 다른 내용');
  assert.equal(inserts(f), 1);
  assert.equal(f.records.find(r => r.id === first.id).process, '증거를 순서대로 비교했습니다.');
  // attempt_id 가 없거나 형식이 틀리면 예전처럼 매번 새 기록이다.
  await f.registry.addRecord(admin, school, f.account.id, observe(), '관리자');
  await f.registry.addRecord(admin, school, f.account.id, observe({ attempt_id: 'not-a-uuid' }), '관리자');
  assert.equal(inserts(f), 3);
});

test('같은 attempt_id 에 날짜·사진만 달라도 409 — 처음 저장으로 조용히 덮지 않는다', async () => {
  const f = recordFixture();
  const attempt_id = crypto.randomUUID();
  const body = observe({ attempt_id, occurred_at: '2026-09-10', photos: [jpeg('첫 장')] });
  const first = await f.registry.addRecord(admin, school, f.account.id, body, '관리자');
  // 날짜가 다르면 다른 저장이다.
  await rejects(f.registry.addRecord(admin, school, f.account.id, { ...body, occurred_at: '2026-09-20' }, '관리자'), 409);
  // 사진 장수·설명·내용이 다르면 다른 저장이다.
  await rejects(f.registry.addRecord(admin, school, f.account.id, { ...body, photos: [] }, '관리자'), 409);
  await rejects(f.registry.addRecord(admin, school, f.account.id, { ...body, photos: [jpeg('첫 장'), jpeg('둘째 장')] }, '관리자'), 409);
  await rejects(f.registry.addRecord(admin, school, f.account.id, { ...body, photos: [jpeg('다른 설명')] }, '관리자'), 409);
  await rejects(f.registry.addRecord(admin, school, f.account.id, { ...body, photos: [{ data: `data:image/jpeg;base64,${'B'.repeat(120)}`, caption: '첫 장' }] }, '관리자'), 409);
  assert.equal(inserts(f), 1);
  assert.equal(new Date(f.records.find(r => r.id === first.id).occurred_at).toISOString().slice(0, 10), '2026-09-10', '처음 날짜 그대로');
  assert.equal(f.photos.length, 1);
  // 같은 날짜·같은 사진이면 재시도로 본다. 날짜를 비워 보낸 재시도는 처음 날짜를 그대로 두는 같은 저장이다.
  assert.deepEqual(await f.registry.addRecord(admin, school, f.account.id, body, '관리자'), { id: first.id, photos: 1, duplicate: true });
  assert.equal((await f.registry.addRecord(admin, school, f.account.id, { ...body, occurred_at: '' }, '관리자')).duplicate, true);
});

test('정정 재시도도 날짜·남긴 사진·새 사진까지 같아야 같은 정정이다', async () => {
  const f = recordFixture();
  const added = await f.registry.addRecord(admin, school, f.account.id, observe({ photos: [jpeg('첫 장'), jpeg('둘째 장')] }), '관리자');
  const [one, two] = f.photos.filter(p => p.record_id === added.id);
  const attempt_id = crypto.randomUUID();
  const body = { activity: '고친 관찰', attempt_id, occurred_at: '2026-09-15', keep_photo_ids: [one.id], photos: [jpeg('새 장')] };
  const revised = await f.registry.reviseRecord(admin, school, f.account.id, added.id, body, '관리자');
  assert.deepEqual(f.photos.filter(p => p.record_id === revised.id).map(p => p.caption), ['첫 장', '새 장']);
  for (const changed of [
    { occurred_at: '2026-09-20' },                // 날짜만 다름
    { keep_photo_ids: [] },                       // 남길 사진이 다름
    { keep_photo_ids: [one.id, two.id] },
    { photos: [] },                               // 새 사진이 다름
    { photos: [jpeg('새 장'), jpeg('또 한 장')] },
  ]) await rejects(f.registry.reviseRecord(admin, school, f.account.id, added.id, { ...body, ...changed }, '관리자'), 409);
  assert.equal(inserts(f), 2, '정정본은 하나만');
  const next = f.records.find(r => r.id === revised.id);
  assert.equal(new Date(next.occurred_at).toISOString().slice(0, 10), '2026-09-15');
  assert.equal(f.photos.filter(p => p.record_id === revised.id).length, 2, '정정본 사진은 처음 정정 그대로');
  assert.deepEqual(await f.registry.reviseRecord(admin, school, f.account.id, added.id, body, '관리자'), { id: revised.id, supersedes: added.id, duplicate: true });
});

test('사진 더하기는 정정을 만들지 않고 사진만 붙인다 — 같은 사진을 다시 보내도 한 번만', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const added = await f.registry.addRecord(partner, school, f.account.id, observe({ photos: [jpeg('수업 중')] }), '스카이');
  const before = inserts(f);
  const result = await f.registry.addPhotos(partner, school, f.account.id, added.id, { photos: [jpeg('수업 중'), { data: `data:image/jpeg;base64,${'C'.repeat(120)}`, caption: '발표' }] });
  assert.deepEqual(result, { id: added.id, photos: 1, total: 2 }, '이미 있는 사진은 건너뛴다');
  assert.equal(inserts(f), before, '기록(새 버전)은 만들지 않는다');
  assert.equal(f.records.some(r => r.supersedes_id === added.id), false, '정정으로 표시되지 않는다');
  assert.equal(f.calls.some(c => /^(UPDATE|DELETE) /.test(c.sql) && c.sql.includes('career_log.records')), false);
  const mine = f.photos.filter(p => p.record_id === added.id);
  assert.deepEqual(mine.map(p => [p.caption, p.position]), [['수업 중', 0], ['발표', 1]]);
  assert.equal(mine[1].student_uuid, f.account.career_student_id, '학생 본인이 열 수 있는 번호');
  assert.equal(mine[1].school_id, school);
  assert.equal(audits(f, 'record_photos_added'), 1);
  // 응답만 잃은 재시도: 같은 사진이면 아무것도 더하지 않는다.
  const again = await f.registry.addPhotos(partner, school, f.account.id, added.id, { photos: [{ data: `data:image/jpeg;base64,${'C'.repeat(120)}`, caption: '발표' }] });
  assert.equal(again.duplicate, true);
  assert.equal(f.photos.filter(p => p.record_id === added.id).length, 2);
  assert.equal(audits(f, 'record_photos_added'), 1);
  // 목록에서는 같은 기록(같은 접수번호)에 사진이 붙어 보인다.
  const list = await f.registry.studentRecords(partner, school, f.account.id);
  assert.equal(list.records.find(r => r.id === added.id).photos.length, 2);
});

test('사진 더하기도 addRecord 와 같은 규칙: 관찰 기록만, 한 기록 6장, 장당·합계 용량, 최신 버전만, 수정 권한', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const pic = n => ({ data: `data:image/jpeg;base64,${String(n).padStart(4, '0').repeat(30)}`, caption: '' });
  const obs = await f.registry.addRecord(partner, school, f.account.id, observe({ photos: [pic(1), pic(2), pic(3), pic(4), pic(5)] }), '스카이');
  await rejects(f.registry.addPhotos(partner, school, f.account.id, obs.id, { photos: [pic(6), pic(7)] }), 400);
  assert.equal(f.photos.length, 5, '상한을 넘는 요청은 한 장도 남기지 않는다');
  await f.registry.addPhotos(partner, school, f.account.id, obs.id, { photos: [pic(6)] });
  assert.equal(f.photos.length, 6);
  await rejects(f.registry.addPhotos(partner, school, f.account.id, obs.id, { photos: [] }), 400);
  await rejects(f.registry.addPhotos(partner, school, f.account.id, obs.id, { photos: [{ data: 'data:application/pdf;base64,AAAA' }] }), 400);
  const big = () => ({ data: `data:image/jpeg;base64,${'A'.repeat(880_000)}` });
  const roomy = await f.registry.addRecord(partner, school, f.account.id, observe(), '스카이');
  await rejects(f.registry.addPhotos(partner, school, f.account.id, roomy.id, { photos: [big(), big(), big(), big()] }), 400);
  await rejects(f.registry.addPhotos(partner, school, f.account.id, roomy.id, { photos: [{ data: `data:image/jpeg;base64,${'A'.repeat(900_001)}` }] }), 400);
  // 일반 담당자 기록·학교 수업 기록에는 붙일 수 없다.
  const staffRecord = await f.registry.addRecord(partner, school, f.account.id, { title: '상담', process: '내용' }, '스카이');
  await rejects(f.registry.addPhotos(partner, school, f.account.id, staffRecord.id, { photos: [pic(8)] }), 400);
  await rejects(f.registry.addPhotos(partner, school, f.account.id, f.hubRecord.id, { photos: [pic(8)] }), 400);
  // 정정된 기록(이전 버전)에는 붙이지 않는다 — 목록에 보이는 최신 버전에 넣어야 한다.
  const revised = await f.registry.reviseRecord(partner, school, f.account.id, roomy.id, { activity: '고침' }, '스카이');
  await rejects(f.registry.addPhotos(partner, school, f.account.id, roomy.id, { photos: [pic(9)] }), 409);
  assert.equal((await f.registry.addPhotos(partner, school, f.account.id, revised.id, { photos: [pic(9)] })).photos, 1, '정정본(관찰 기록)에는 붙는다');
  // 열람 권한만 있거나 권한이 없으면 막힌다.
  await f.registry.setRecordAccess(admin, school, '91', 'view');
  await rejects(f.registry.addPhotos(partner, school, f.account.id, revised.id, { photos: [pic(10)] }), 403);
  await rejects(f.registry.addPhotos(sky, school, f.account.id, revised.id, { photos: [pic(10)] }), 403);
  assert.equal(f.photos.some(p => p.data === pic(10).data.split(',')[1]), false);
});

test('정정은 웹앱 연결을 이어받고, 같은 attempt_id 재시도는 처음 정정을 돌려준다', async () => {
  const f = recordFixture();
  const added = await f.registry.addRecord(admin, school, f.account.id, observe({ deck_id: 8 }), '관리자');
  const attempt_id = crypto.randomUUID();
  const body = { activity: '고친 관찰', strengths: '근거를 꼼꼼히 봅니다.', attempt_id };
  const revised = await f.registry.reviseRecord(admin, school, f.account.id, added.id, body, '관리자');
  const next = f.records.find(r => r.id === revised.id);
  assert.equal(next.raw_data.job.deck_id, 8, '웹앱 연결은 정정본에도 남는다');
  assert.equal(next.raw_data.job.deck_title, '항공 관제 웹앱');
  assert.equal(next.source_event_id, `job-revision:${added.id}:${attempt_id}`);
  const retry = await f.registry.reviseRecord(admin, school, f.account.id, added.id, body, '관리자');
  assert.deepEqual(retry, { id: revised.id, supersedes: added.id, duplicate: true });
  assert.equal(inserts(f), 2, '정정본은 하나만');
  assert.equal(audits(f, 'record_revised'), 1);
  // 같은 시도 번호라도 내용이 다르거나, 새 시도 번호면 이미 정정된 기록이라 409.
  await rejects(f.registry.reviseRecord(admin, school, f.account.id, added.id, { ...body, activity: '또 고침' }, '관리자'), 409);
  await rejects(f.registry.reviseRecord(admin, school, f.account.id, added.id, { ...body, attempt_id: crypto.randomUUID() }, '관리자'), 409);
  await rejects(f.registry.reviseRecord(admin, school, f.account.id, added.id, { activity: '고친 관찰' }, '관리자'), 409);
  assert.equal(inserts(f), 2);
});

test('API 는 재시도로 확인된 저장에 200, 새 저장에 201 을 돌려주고 둘 다 saved:true 다', async () => {
  const { registerSchoolRegistryRoutes } = require('../lib/school-registry-api');
  const routes = [], logs = [];
  let duplicate = false;
  const registry = {
    addRecord: async () => (duplicate ? { id: 'r1', photos: 0, duplicate: true } : { id: 'r1', photos: 0 }),
    reviseRecord: async () => (duplicate ? { id: 'r2', supersedes: 'r1', duplicate: true } : { id: 'r2', supersedes: 'r1' }),
    addPhotos: async () => (duplicate ? { id: 'r1', photos: 0, total: 1, duplicate: true } : { id: 'r1', photos: 1, total: 1 }),
  };
  registerSchoolRegistryRoutes({ route: (method, pattern, minRole, handler) => routes.push({ method, pattern, handler }), one: async () => null,
    json: (res, status, body) => { res.status = status; res.body = body; }, log: async (...args) => { logs.push(args); }, registry });
  const call = async path => {
    const r = routes.find(item => item.method === 'POST' && item.pattern.test(path));
    const res = { setHeader() {} };
    await r.handler({ method: 'POST', url: path, headers: { host: 'job.moakit.ai', origin: 'https://job.moakit.ai' } }, res, { user: admin, params: r.pattern.exec(path).slice(1), body: {} });
    return res;
  };
  const base = `/api/school-accounts/schools/${school}/students/${crypto.randomUUID()}/records`;
  for (const path of [base, `${base}/${crypto.randomUUID()}/revise`, `${base}/${crypto.randomUUID()}/photos`]) {
    duplicate = false;
    const created = await call(path);
    assert.equal(created.status, 201); assert.equal(created.body.saved, true);
    duplicate = true;
    const repeated = await call(path);
    assert.equal(repeated.status, 200); assert.equal(repeated.body.saved, true); assert.equal(repeated.body.duplicate, true);
  }
  assert.equal(logs.length, 3, '재시도는 활동 로그를 다시 남기지 않는다');
});

test('사진 더하기 경로는 진로업체 담당자 허용 목록 안에 있다', () => {
  // lib/api.js 는 lib/db.js 를 통해 DATABASE_URL 을 요구한다. 연결은 질의할 때 열리므로 더미 값이면 충분하다.
  process.env.DATABASE_URL ||= 'postgresql://u:p@127.0.0.1:5432/none';
  const { PARTNER_ALLOW } = require('../lib/api');
  const photos = `/api/school-accounts/schools/${school}/students/${crypto.randomUUID()}/records/${crypto.randomUUID()}/photos`;
  assert.ok(PARTNER_ALLOW.some(re => re.test(photos)));
});

// ---- 정정해도 쓴 사람은 그대로, 고친 사람은 따로 ----
test('정정본은 처음 쓴 사람(author_name)을 지키고 고친 사람을 revised_by_name 에 남긴다', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '91', 'edit');
  const added = await f.registry.addRecord(partner, school, f.account.id, observe(), '스카이 진로업체');
  const revised = await f.registry.reviseRecord(admin, school, f.account.id, added.id, { activity: '고친 관찰' }, '모아킷 관리자');
  const job = f.records.find(r => r.id === revised.id).raw_data.job;
  assert.equal(job.author_name, '스카이 진로업체', '학생에게 고친 사람이 쓴 사람으로 보이면 안 된다');
  assert.equal(job.revised_by_name, '모아킷 관리자');
  assert.equal(job.revised_by, 'moakit-lab:1');
  assert.equal(job.author, 'moakit-lab:91', '처음 쓴 계정도 그대로');
  // 두 번째 정정도 처음 쓴 사람을 지킨다.
  const again = await f.registry.reviseRecord(partner, school, f.account.id, revised.id, { activity: '또 고친 관찰' }, '스카이 진로업체');
  const next = f.records.find(r => r.id === again.id).raw_data.job;
  assert.equal(next.author_name, '스카이 진로업체');
  assert.equal(next.revised_by_name, '스카이 진로업체');
  // 담당자 기록(상담)도 같다 — 정정본의 entry_kind 는 'revision' 이라 program_ref 로 가린다.
  const staffRecord = await f.registry.addRecord(partner, school, f.account.id, { title: '상담', process: '내용' }, '스카이 진로업체');
  const staffRevised = await f.registry.reviseRecord(admin, school, f.account.id, staffRecord.id, { process: '고친 내용' }, '모아킷 관리자');
  const staffJob = f.records.find(r => r.id === staffRevised.id).raw_data.job;
  assert.deepEqual([staffJob.author_name, staffJob.revised_by_name], ['스카이 진로업체', '모아킷 관리자']);
});

test('학생이 쓴 기록을 고친 정정본에는 쓴 사람 이름을 붙이지 않는다 — 고친 사람만 남는다', async () => {
  const f = recordFixture();
  const revised = await f.registry.reviseRecord(admin, school, f.account.id, f.hubRecord.id, { process: '고친 관찰' }, '모아킷 관리자');
  const job = f.records.find(r => r.id === revised.id).raw_data.job;
  assert.equal(job.author_name, undefined);
  assert.equal(job.revised_by_name, '모아킷 관리자');
  // 웹앱에서 학생이 직접 쓴 기록도 같다.
  const own = studentDeckRecord(f, 7, '디지털 포렌식 웹앱');
  const ownRevised = await f.registry.reviseRecord(admin, school, f.account.id, own.id, { process: '고친 과정' }, '모아킷 관리자');
  const ownJob = f.records.find(r => r.id === ownRevised.id).raw_data.job;
  assert.equal(ownJob.author_name, undefined);
  assert.equal(ownJob.entry_kind, 'revision');
  assert.equal(ownJob.deck_title, '디지털 포렌식 웹앱', '웹앱 정보는 그대로 이어진다');
});

test('예전 정정본(author_name 에 고친 사람이 들어 있음)을 다시 고치면 처음 쓴 사람을 원본에서 되찾는다', async () => {
  const f = recordFixture();
  const original = await f.registry.addRecord(admin, school, f.account.id, observe(), '처음 쓴 강사');
  // 예전 코드가 남긴 정정본: revised_by_name 이 없고 author_name 이 고친 사람이다.
  const legacy = { id: crypto.randomUUID(), student_id: f.account.career_student_id, session_ref: `job-school:${school}`, program_ref: 'job-career-observation', occurred_at: '2026-09-12T00:00:00Z',
    process: '예전 정정', artifact: null, reflection: null, source: 'job', supersedes_id: original.id, source_event_id: `job-revision:${original.id}:${crypto.randomUUID()}`,
    raw_data: { job: { entry_kind: 'revision', observation_kind: 'career_observation', observation: { activity: '예전 정정' }, title: '포렌식 웹앱 관찰', author: 'moakit-lab:1', author_name: '예전에 고친 사람', revised_by: 'moakit-lab:3' } } };
  f.records.push(legacy);
  const revised = await f.registry.reviseRecord(admin, school, f.account.id, legacy.id, { activity: '새로 고침' }, '지금 고친 사람');
  const job = f.records.find(r => r.id === revised.id).raw_data.job;
  assert.equal(job.author_name, '처음 쓴 강사');
  assert.equal(job.revised_by_name, '지금 고친 사람');
  // 예전 정정본이 학생 기록을 고친 것이면 이름을 붙이지 않는다.
  const legacyStudent = { ...legacy, id: crypto.randomUUID(), program_ref: 'job-deck:7', supersedes_id: null, source_event_id: `job:${crypto.randomUUID()}`,
    raw_data: { job: { entry_kind: 'revision', deck_id: 7, author_name: '예전에 고친 사람', revised_by: 'moakit-lab:3' } } };
  f.records.push(legacyStudent);
  const studentRevised = await f.registry.reviseRecord(admin, school, f.account.id, legacyStudent.id, { process: '고침' }, '지금 고친 사람');
  assert.equal(f.records.find(r => r.id === studentRevised.id).raw_data.job.author_name, undefined);
});

test('관리자·담당자 목록 응답에 고친 사람(revised_by_name)이 실린다', async () => {
  const f = recordFixture();
  await f.registry.studentRecords(admin, school, f.account.id);
  const listSql = f.calls.findLast(c => c.sql.includes('WHERE r.student_id = $1 AND NOT EXISTS')).sql;
  assert.match(listSql, /'revised_by_name' AS revised_by_name/);
});

// ---- 웹앱 연결 규칙 ----
test('웹앱 연결은 진로 관찰 기록에만 — 담당자 기록에 deck_id 를 보내면 400 이고 아무것도 남기지 않는다', async () => {
  const f = recordFixture();
  studentDeckRecord(f, 7, '디지털 포렌식 웹앱');
  await rejects(f.registry.addRecord(admin, school, f.account.id, { title: '상담', process: '내용', deck_id: 7 }, '관리자'), 400);
  await rejects(f.registry.addRecord(admin, school, f.account.id, { kind: 'staff_record', title: '상담', process: '내용', deck_id: 8 }, '관리자'), 400);
  assert.equal(inserts(f), 0);
  // 웹앱 없이 보내면 그대로 저장된다.
  const plain = await f.registry.addRecord(admin, school, f.account.id, { title: '상담', process: '내용' }, '관리자');
  assert.equal(f.records.find(r => r.id === plain.id).raw_data.job.deck_id, undefined);
});

test('아무 웹앱이나 잇는 것은 관리자만 — 강사도 이 학생이 활동한 웹앱만, 없는 번호와 남의 웹앱은 같은 답', async () => {
  const f = recordFixture();
  await f.registry.setRecordAccess(admin, school, '77', 'edit');
  // 8번은 있는 웹앱이지만 이 학생 기록에 없다. 999번은 없는 웹앱이다. 둘 다 403 — 웹앱이 있는지 새지 않는다.
  await rejects(f.registry.addRecord(sky, school, f.account.id, observe({ deck_id: 8 }), '스카이 담당자'), 403);
  await rejects(f.registry.addRecord(sky, school, f.account.id, observe({ deck_id: 999 }), '스카이 담당자'), 403);
  assert.equal(f.calls.some(c => c.sql.startsWith('SELECT id, title FROM decks')), false, '권한이 없으면 웹앱 제목을 읽지도 않는다');
  assert.equal(inserts(f), 0);
  studentDeckRecord(f, 7, '디지털 포렌식 웹앱');
  const added = await f.registry.addRecord(sky, school, f.account.id, observe({ deck_id: 7 }), '스카이 담당자');
  assert.equal(f.records.find(r => r.id === added.id).raw_data.job.deck_title, '디지털 포렌식 웹앱');
  // 관리자는 학생 기록에 없는 웹앱도 잇고, 없는 웹앱은 404 다.
  assert.ok((await f.registry.addRecord(admin, school, f.account.id, observe({ deck_id: 8 }), '관리자')).id);
  await rejects(f.registry.addRecord(admin, school, f.account.id, observe({ deck_id: 999 }), '관리자'), 404);
});

test('같은 attempt_id 에 다른 내용이면 409 에 화면이 가려낼 code 를 붙여 응답한다', async () => {
  const f = recordFixture();
  const attempt_id = crypto.randomUUID();
  await f.registry.addRecord(admin, school, f.account.id, observe({ attempt_id }), '관리자');
  await assert.rejects(f.registry.addRecord(admin, school, f.account.id, observe({ attempt_id, activity: '바뀐 내용' }), '관리자'),
    e => e.status === 409 && e.code === 'attempt_conflict');
  // API 는 code 를 응답 본문에 싣는다. code 가 없는 실패에는 붙이지 않는다.
  const { registerSchoolRegistryRoutes } = require('../lib/school-registry-api');
  const routes = [];
  let thrown;
  registerSchoolRegistryRoutes({ route: (method, pattern, minRole, handler) => routes.push({ method, pattern, handler }), one: async () => null,
    json: (res, status, body) => { res.status = status; res.body = body; }, log: async () => {}, registry: { addRecord: async () => { throw thrown; } } });
  const path = `/api/school-accounts/schools/${school}/students/${crypto.randomUUID()}/records`;
  const r = routes.find(item => item.method === 'POST' && item.pattern.test(path));
  const call = async error => {
    thrown = error;
    const res = { setHeader() {} };
    await r.handler({ method: 'POST', url: path, headers: { host: 'job.moakit.ai', origin: 'https://job.moakit.ai' } }, res, { user: admin, params: r.pattern.exec(path).slice(1), body: {} });
    return res;
  };
  const conflict = await call(Object.assign(new Error('이미 다른 내용'), { status: 409, code: 'attempt_conflict' }));
  assert.deepEqual([conflict.status, conflict.body], [409, { error: '이미 다른 내용', code: 'attempt_conflict' }]);
  const plain = await call(Object.assign(new Error('기록 수정 권한이 없습니다.'), { status: 403 }));
  assert.deepEqual(plain.body, { error: '기록 수정 권한이 없습니다.' });
});
