'use strict';

// 외부 링크 자료의 '카메라·마이크 사용'(decks.media_access).
// 크롬은 최상위 문서가 받은 카메라·마이크 허용을 위임받은 iframe 과 함께 쓴다. 그래서 모든 외부 링크에 위임하지 않고
// 자료 주인·관리자 이상이 자료별로 켠다. 실제 lib/api.js 핸들러를 가짜 DB(lib/db.js 자리)로 돌려 권한과 저장을 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');

// ---- 가짜 DB: lib/api.js 가 불러오기 전에 lib/db.js 자리에 넣는다 (node --test 는 파일마다 따로 돈다) ----
const db = { users: new Map(), sessions: new Map(), decks: new Map(), writes: [], logs: [] };
async function q(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s.startsWith('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token')) {
    const user = db.users.get(db.sessions.get(params[0]));
    return user && user.active !== false ? [{ ...user }] : [];
  }
  if (s.startsWith('SELECT * FROM users WHERE id')) return db.users.has(params[0]) ? [{ ...db.users.get(params[0]) }] : [];
  if (s.startsWith('SELECT * FROM decks WHERE id')) return db.decks.has(params[0]) ? [{ ...db.decks.get(params[0]) }] : [];
  if (s.includes('FROM decks d LEFT JOIN users u') && s.endsWith('WHERE d.id = $1')) {
    return db.decks.has(params[0]) ? [{ ...db.decks.get(params[0]), owner_name: '강사', slide_count: 0 }] : [];
  }
  if (s.startsWith('SELECT * FROM slides')) return [];
  if (s.startsWith('INSERT INTO decks')) { db.writes.push({ sql: s, params }); return [{ id: 99 }]; }
  if (s.startsWith('UPDATE decks') || s.startsWith('INSERT INTO assets') || s.startsWith('DELETE FROM assets')) {
    db.writes.push({ sql: s, params });
    const m = /^UPDATE decks SET (\w+) = \$1 WHERE id = \$2$/.exec(s);
    if (m && db.decks.has(params[1])) db.decks.get(params[1])[m[1]] = params[0];
    return [];
  }
  throw new Error(`테스트에서 예상하지 못한 SQL: ${s}`);
}
const fakeDb = {
  q,
  one: async (sql, params) => (await q(sql, params))[0] || null,
  withTransaction: async () => { throw new Error('트랜잭션은 쓰지 않는다'); },
  ready: async () => {},
  log: async (user, action, detail) => { db.logs.push({ user: user && user.id, action, detail }); },
  getSettings: async () => ({}),
  setSetting: async () => {},
  clientIp: () => '127.0.0.1',
  TS: (col) => col,
  KST_TODAY: 'now()',
  DEFAULT_AGREEMENT: '',
};
const dbPath = require.resolve('../lib/db');
const fake = new Module(dbPath, module);
fake.filename = dbPath;
fake.loaded = true;
fake.exports = fakeDb;
require.cache[dbPath] = fake;

const { handleApi } = require('../lib/api');

function call(method, url, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      writeHead(status) { this.status = status; return this; },
      setHeader() {},
      end(data) { resolve({ status: this.status, body: data ? JSON.parse(String(data)) : null }); },
    };
    const req = { method, url, headers: token ? { cookie: `session=${token}` } : {}, socket: { remoteAddress: '127.0.0.1' } };
    handleApi(req, res, url, body ?? null).catch(reject);
  });
}

const USERS = {
  owner: { id: 1, username: 'owner', role: 'instructor', agreed_version: 1, active: true },
  other: { id: 2, username: 'other', role: 'instructor', agreed_version: 1, active: true },
  admin: { id: 3, username: 'admin', role: 'admin', agreed_version: 1, active: true },
  partner: { id: 4, username: 'partner', role: 'partner', active: true },
  student: { id: 5, username: 'student', role: 'student', active: true },
};
for (const [token, u] of Object.entries(USERS)) { db.users.set(u.id, u); db.sessions.set(token, u.id); }

function reset() {
  db.decks.clear();
  db.writes.length = 0;
  db.logs.length = 0;
  db.decks.set(5, { id: 5, title: '표정 인식', kind: 'link', external_url: 'https://example.com/app', created_by: 1, published: false, media_access: false });
  db.decks.set(7, { id: 7, title: '업로드 앱', kind: 'html', external_url: '', created_by: 1, published: false, media_access: false });
}
const mediaWrites = () => db.writes.filter((w) => w.sql.startsWith('UPDATE decks SET media_access'));

test('마이그레이션: decks.media_access 는 기본 끔', () => {
  const src = fs.readFileSync(path.join(root, 'lib/db.js'), 'utf8');
  const migrations = src.slice(src.indexOf('const MIGRATIONS = `'), src.indexOf('`;', src.indexOf('const MIGRATIONS = `')));
  assert.match(migrations, /ALTER TABLE decks ADD COLUMN IF NOT EXISTS media_access BOOLEAN NOT NULL DEFAULT false;/);
});

test('자료 주인은 자기 외부 링크의 카메라·마이크 사용을 켜고 끈다 (감사 기록에 남는다)', async () => {
  reset();
  let r = await call('PATCH', '/api/decks/5', { token: 'owner', body: { media_access: true } });
  assert.equal(r.status, 200);
  assert.equal(db.decks.get(5).media_access, true);
  assert.match(db.logs.at(-1).detail, /^id=5 media_access=on$/);
  r = await call('PATCH', '/api/decks/5', { token: 'owner', body: { media_access: false } });
  assert.equal(r.status, 200);
  assert.equal(db.decks.get(5).media_access, false);
  assert.match(db.logs.at(-1).detail, /media_access=off/);
});

test('관리자 이상은 남의 자료도 바꾸고, 다른 강사·진로업체 담당자·학생은 못 바꾼다', async () => {
  reset();
  assert.equal((await call('PATCH', '/api/decks/5', { token: 'other', body: { media_access: true } })).status, 403);
  assert.equal((await call('PATCH', '/api/decks/5', { token: 'partner', body: { media_access: true } })).status, 403);
  assert.equal((await call('PATCH', '/api/decks/5', { token: 'student', body: { media_access: true } })).status, 403);
  assert.equal((await call('PATCH', '/api/decks/5', { body: { media_access: true } })).status, 401);
  assert.equal(mediaWrites().length, 0);
  assert.equal(db.decks.get(5).media_access, false);
  assert.equal((await call('PATCH', '/api/decks/5', { token: 'admin', body: { media_access: true } })).status, 200);
  assert.equal(db.decks.get(5).media_access, true);
});

test('HTML 업로드 자료에는 켜지지 않고, true 가 아닌 값은 끔으로 본다', async () => {
  reset();
  await call('PATCH', '/api/decks/7', { token: 'owner', body: { media_access: true } });
  assert.equal(db.decks.get(7).media_access, false, '불투명 출처라 줘도 소용없고, 켜진 것처럼 보이면 안 된다');
  db.decks.get(5).media_access = true;
  await call('PATCH', '/api/decks/5', { token: 'owner', body: { media_access: 'true' } });
  assert.equal(db.decks.get(5).media_access, false);
  // 값을 보내지 않은 수정(제목 등)은 건드리지 않는다
  db.decks.get(5).media_access = true;
  db.writes.length = 0;
  await call('PATCH', '/api/decks/5', { token: 'owner', body: { title: '새 제목' } });
  assert.equal(mediaWrites().length, 0);
  assert.equal(db.decks.get(5).media_access, true);
});

test('새 자료: 외부 링크에서 명시적으로 켰을 때만 켜진 채로 만든다', async () => {
  reset();
  const created = async (body) => {
    db.writes.length = 0;
    const r = await call('POST', '/api/decks', { token: 'owner', body: { title: '새 자료', ...body } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ins = db.writes.find((w) => w.sql.startsWith('INSERT INTO decks'));
    assert.match(ins.sql, /media_access\) VALUES \(.*\$10\)/);
    return ins.params[9];
  };
  assert.equal(await created({ kind: 'link', external_url: 'https://example.com/a', media_access: true }), true);
  assert.equal(await created({ kind: 'link', external_url: 'https://example.com/a' }), false);
  assert.equal(await created({ kind: 'link', external_url: 'https://example.com/a', media_access: 1 }), false);
  assert.equal(await created({ kind: 'html', html: '<p>x</p>', media_access: true }), false);
  assert.equal(await created({ kind: 'slides', media_access: true }), false);
});

test('자료 응답에 mediaAccess 를 싣는다 (예전 필드는 그대로, 외부 링크만 true 가 될 수 있다)', async () => {
  reset();
  db.decks.get(5).media_access = true;
  const link = await call('GET', '/api/decks/5', { token: 'admin' });
  assert.equal(link.status, 200);
  assert.equal(link.body.deck.mediaAccess, true);
  assert.equal(link.body.deck.external_url, 'https://example.com/app');
  assert.equal(link.body.deck.kind, 'link');
  db.decks.get(7).media_access = true; // DB 에 잘못 들어가 있어도
  const html = await call('GET', '/api/decks/7', { token: 'admin' });
  assert.equal(html.body.deck.mediaAccess, false);
});
