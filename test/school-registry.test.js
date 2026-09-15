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
    if (sql.startsWith('INSERT INTO career_log.records')) {
      const r = { id: crypto.randomUUID(), student_id: values[0], session_ref: values[1], program_ref: values[2], occurred_at: values[3], process: values[4], artifact: values[5], reflection: values[6], source: 'job', raw_data: JSON.parse(values[7]), supersedes_id: values[9] ?? null };
      records.push(r); return [{ id: r.id }];
    }
    if (sql.includes('WITH RECURSIVE chain')) { const out = []; let cur = records.find(r => r.id === values[0]); while (cur && cur.supersedes_id) { cur = records.find(r => r.id === cur.supersedes_id); if (cur) out.push(cur); } return out; }
    throw new Error('Unhandled: ' + sql.slice(0, 80));
  }
  const one = async (sql, values) => (await q(sql, values))[0] || null;
  const withTransaction = work => work({ q, one });
  return { registry: createSchoolRegistry({ withTransaction, roleLevel }), calls, access, records, photos, account, hubRecord };
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
