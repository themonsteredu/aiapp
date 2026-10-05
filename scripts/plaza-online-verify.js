'use strict';
// Online test mode check over plain HTTP plus read-only DB assertions. It runs in the server's
// process against the online configuration (docs/plaza-online-test.md, "온라인 흉내 시험"), with
// the same accounts and screens a teacher uses: no rows are written directly.
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs/promises'), path = require('node:path');
const { plazaConfig } = require('../lib/plaza-config');
const { jpegInput } = require('../lib/plaza-storage');
const { client, ok, prepare, advance } = require('./plaza-rehearsal');
const uuid = () => crypto.randomUUID();

// The seeded superadmin changes its password, then creates one instructor and one admin.
async function bootstrap({ base }) {
  const password = () => crypto.randomBytes(18).toString('base64url');
  const first = (who, next) => ok(who.request('POST', '/api/password', { current: who.password, next })).then(() => { who.password = next; });
  const su = Object.assign(client(base), { password: process.env.SUPERADMIN_PASSWORD });
  await ok(su.request('POST', '/api/login', { username: 'superadmin', password: su.password }));
  await first(su, password());
  const staff = {};
  for (const role of ['instructor', 'admin']) {
    const username = `plaza-online-${role}-${crypto.randomBytes(3).toString('hex')}`, initial = password();
    await ok(su.request('POST', '/api/users', { username, name: `온라인 시험 ${role}`, role, password: initial }));
    const person = Object.assign(client(base), { password: initial });
    await ok(person.request('POST', '/api/login', { username, password: initial }));
    await first(person, password());
    await ok(person.request('POST', '/api/agree', { consent: true, name: `온라인 시험 ${role}` }));
    staff[role] = { username, password: person.password };
  }
  return { teacher: staff.instructor, admin: staff.admin };
}

async function verify({ base = 'http://127.0.0.1:4999', accounts } = {}) {
  const config = plazaConfig();
  if (!config?.online) throw new Error('광장 온라인 시험 설정에서만 실행합니다.');
  const db = require('../lib/db');
  let checks = 0; const check = (v, label) => { assert.ok(v, label); checks++; console.log('PASS', label); };
  const status = await ok(client(base).request('GET', '/api/deployment-status'));
  check(status.mode === 'plaza-online-test' && status.ready && status.database === 'connected', '온라인 시험 상태 확인: DB 연결·시험 표식 일치');
  const marker = await db.one('SELECT purpose, project_ref, test_id FROM plaza_environment WHERE singleton');
  check(marker.purpose === 'online-test' && marker.project_ref === config.projectRef && marker.test_id === config.testId, '시험 DB 표식은 시험 프로젝트 번호와 시험 번호에 묶임');
  accounts ||= await bootstrap({ base });
  const teacher = client(base), admin = client(base);
  await ok(teacher.request('POST', '/api/login', accounts.teacher)); await ok(admin.request('POST', '/api/login', accounts.admin));
  const me = await ok(teacher.request('GET', '/api/me'));
  check(me.settings.plaza_stage1 && me.settings.plaza_stage4 && me.settings.plaza_stage5, '온라인 시험 서버에서 광장 1~5단계 기능이 켜짐');
  // Teacher screens: material, class code, program card, plaza; admin: retention.
  const catalog = await ok(teacher.request('GET', '/api/plaza/programs'));
  const card = catalog.synthetic_templates.find(c => c.program_key === 'perfumer-gypsum');
  check(!!card && !catalog.real_collection_allowed, '온라인 시험도 가짜 키트 카드만 쓰고 실제 수집은 차단');
  const deck = await ok(teacher.request('POST', '/api/decks', { title: '조향사 광장 · 온라인 시험', kind: 'link', external_url: `${config.publicOrigin}/class` }));
  await ok(teacher.request('PATCH', `/api/decks/${deck.id}`, { published: true }));
  const cs = await ok(teacher.request('POST', '/api/class-sessions', { title: '온라인 시험 수업', deck_ids: [deck.id], duration_minutes: 180 }));
  const program = await ok(teacher.request('POST', '/api/plaza/programs', { deck_id: deck.id, card }));
  const prepared = await ok(teacher.request('POST', '/api/plaza/rooms', { class_session_id: cs.id, program_version_id: program.id, seat_count: 3 }));
  const room = `/api/plaza/rooms/${prepared.id}`;
  await ok(admin.request('POST', room + '/retention/policy', { photo_hours: 1, activity_hours: 2, audit_hours: 3, confirm_test_only: true }));
  const group = await prepare({ base, fixture: { teacher: accounts.teacher, roomId: prepared.id, code: cs.code }, count: 3,
    choices: [{ photo_allowed: true }, { photo_allowed: true }, { record_choice: 'no-record', photo_allowed: true }] });
  const people = group.people;
  const info = () => ok(teacher.request('GET', room + '/teacher'));
  const seat = async n => (await info()).participants.find(p => p.seat_order === n);
  // Photos go to the test database, never to a file or bucket.
  const dataUrl = await fs.readFile(path.join(__dirname, '../test/fixtures/plaza-photo.txt'), 'utf8');
  const image = jpegInput(dataUrl);
  async function photograph(n) {
    const p = await seat(n), id = uuid();
    await ok(teacher.request('POST', room + '/photos', { capture_id: id, participant_id: p.id, target_version: p.target_version }));
    const saved = await ok(teacher.request('PUT', room + '/photos/' + id, { data_url: dataUrl, target_version: p.target_version }));
    const object = await db.one('SELECT o.object_key, b.digest FROM plaza_photo_objects o LEFT JOIN plaza_photo_blobs b ON b.object_key = o.object_key WHERE o.photo_id = $1', [id]);
    return { id, saved, ...object };
  }
  const first = await photograph(1);
  check(first.saved.saved && first.digest === image.digest, '촬영 사진은 시험 DB 비공개 표에 저장되고 서버가 확인한 뒤에만 저장됨');
  const mine = await ok(people[0].client.request('GET', room + '/mine'));
  const shown = await people[0].client.request('GET', mine.photo_url);
  check(shown.status === 200 && crypto.createHash('sha256').update(shown.data).digest('hex') === image.digest
    && shown.headers.get('cache-control') === 'private, no-store', '학생 본인은 앱 경로로만 자기 작품 사진을 봄');
  check((await people[1].client.request('GET', mine.photo_url)).status === 404, '개장 전 다른 학생의 사진은 보이지 않음');
  check((await client(base).request('GET', mine.photo_url)).status === 401, '로그인하지 않은 사람은 사진 주소를 알아도 못 봄');
  // Withdrawal deletes the bytes from the database and leaves an append-only marker.
  const second = await photograph(2);
  const privacy = (await ok(people[1].client.request('GET', room + '/mine'))).privacy;
  const withdrawn = await ok(people[1].client.request('POST', room + '/photo-choice', { photo_allowed: false, version: privacy.privacy_version, attempt_id: uuid() }));
  check(withdrawn.purge.status === 'verified' && !withdrawn.photo_allowed, '학생의 사진 철회는 바로 파기·확인까지 끝남');
  check(!await db.one('SELECT 1 FROM plaza_photo_blobs WHERE object_key = $1', [second.object_key]), '철회한 사진 원본이 시험 DB에서 실제로 사라짐');
  check(!!await db.one("SELECT 1 FROM plaza_purge_ledger WHERE kind = 'object' AND id = $1", [second.object_key]), '파기한 사진은 삭제 목록에 남아 다시 올릴 수 없음');
  check(withdrawn.purge.whole_system_complete === false, '백업까지 지웠다고 표시하지 않음');
  // Class routine to the end, then the record card QR points at this Preview's own address.
  const state = async name => { const s = await info(); return ok(teacher.request('POST', room + '/state', { state: name, version: s.room.version, participant_ids: s.participants.map(p => p.id), reason: '온라인 시험 진행' })); };
  await state('paused'); await state('returning'); await advance(group); await state('exchange'); await advance(group); await state('reflection'); await advance(group);
  const done = await ok(people[0].client.request('GET', room + '/mine'));
  check(done.receipt?.saved, '구상·제작 확인·교류·돌아보기 뒤 진로기록 저장');
  const qr = await ok(people[0].client.request('GET', `/api/career-log/records/${done.receipt.record_id}/card`));
  const url = new URL(qr.url);
  check(url.origin === config.publicOrigin && url.hash === `#/plaza-record/${done.receipt.record_id}` && !url.search, 'QR 주소는 이 시험 배포 주소와 기록 번호만 담음');
  await state('closed');
  check((await ok(admin.request('GET', room + '/retention/preview'))).scopes.length === 0, '보관 기간 전에는 파기 대상이 없음');
  // Data API roles cannot reach any table of the test project.
  const exposed = await db.one(`SELECT count(*)::int AS n FROM pg_tables t WHERE t.schemaname IN ('public','career_log')
    AND (has_table_privilege('anon', format('%I.%I', t.schemaname, t.tablename), 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'SELECT,INSERT,UPDATE,DELETE'))`);
  check(exposed.n === 0, '공개 키(anon·authenticated)로 읽거나 쓸 수 있는 표 없음');
  check(!(await db.one("SELECT has_schema_privilege('anon','public','USAGE') OR has_schema_privilege('authenticated','public','USAGE') AS u")).u, '공개 키 역할은 public 스키마를 쓸 수 없음');
  const open = await db.one("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname IN ('public','career_log') AND NOT rowsecurity");
  check(open.n === 0, '모든 표에 행 보안(RLS) 적용');
  console.log(`온라인 시험 모드 HTTP·DB 검증 ${checks}개 통과`);
  return { checks, fixture: { ...accounts, deckId: deck.id } };
}
module.exports = { bootstrap, verify };
