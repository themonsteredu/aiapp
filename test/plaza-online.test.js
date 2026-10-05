'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const online = require('../lib/plaza-online');
const { plazaConfig } = require('../lib/plaza-config');
const { cardUrl } = require('../lib/plaza-record-card');

const root = path.join(__dirname, '..');
const REF = online.TEST_REF;
function env(extra = {}) {
  return {
    PLAZA_ONLINE_TEST: '1', VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview',
    VERCEL_GIT_COMMIT_REF: online.ONLINE_BRANCH,
    VERCEL_BRANCH_URL: 'aiapp-git-feat-plaza-online-test-20261005-themonsteredu.vercel.app',
    PLAZA_STAGE1_TEST: '1', PLAZA_STAGE2_TEST: '1', PLAZA_STAGE3_TEST: '1', PLAZA_STAGE4_TEST: '1', PLAZA_STAGE5_TEST: '1',
    PLAZA_SYNTHETIC_KIT: '1', PLAZA_TEST_ID: crypto.randomUUID(), SUPERADMIN_PASSWORD: 'a-long-test-password',
    PLAZA_ONLINE_DATABASE_URL: `postgresql://postgres.${REF}:secret@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres`,
    // An inherited production URL must be ignored, not merely outranked.
    DATABASE_URL: `postgresql://postgres.${online.PRODUCTION_REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres`,
    ...extra,
  };
}
const reason = extra => online.onlineGate(env(extra)).reason;

test('online test mode opens only for the one Preview branch and the disposable project', () => {
  const gate = online.onlineGate(env());
  assert.equal(gate.ok, true);
  assert.equal(gate.projectRef, REF);
  assert.equal(gate.publicOrigin, 'https://aiapp-git-feat-plaza-online-test-20261005-themonsteredu.vercel.app');
  assert.ok(!gate.databaseUrl.includes(online.PRODUCTION_REF));
  assert.equal(online.entryBlocked(env()), null);
  assert.equal(online.active(env()), true);
});

test('online gate refuses every setting that could reach production or another database', () => {
  const url = rest => `postgresql://${rest}`;
  const cases = {
    not_preview: [{ VERCEL: undefined }, { VERCEL_ENV: 'development' }, { VERCEL_TARGET_ENV: 'staging' }],
    branch: [{ VERCEL_GIT_COMMIT_REF: 'claude/career-education-webapp-xem8ui' }, { VERCEL_GIT_COMMIT_REF: undefined }],
    branch_url: [{ VERCEL_BRANCH_URL: 'job.moakit.ai' }, { VERCEL_BRANCH_URL: undefined }],
    stage_flags: [{ PLAZA_STAGE4_TEST: undefined }],
    synthetic_kit: [{ PLAZA_SYNTHETIC_KIT: undefined }],
    test_id: [{ PLAZA_TEST_ID: 'not-a-uuid' }],
    file_storage: [{ PLAZA_TEST_STORAGE_DIR: '/tmp/plaza' }],
    media_storage: [{ SUPABASE_URL: `https://${online.PRODUCTION_REF}.supabase.co` }, { SUPABASE_SERVICE_KEY: 'x' }],
    pg_override: [{ PGHOST: 'db.example' }, { PGSSLMODE: 'disable' }, { PGUSER: 'postgres' }],
    superadmin_password: [{ SUPERADMIN_PASSWORD: undefined }, { SUPERADMIN_PASSWORD: 'ChangeMe123!' }],
    database_url_missing: [{ PLAZA_ONLINE_DATABASE_URL: undefined }],
    database_url_production: [
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${online.PRODUCTION_REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres`) },
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres:x@db.${online.PRODUCTION_REF}.supabase.co:5432/postgres`) },
    ],
    database_url_format: [
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?host=evil.example`) },
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=disable`) },
      { PLAZA_ONLINE_DATABASE_URL: `mysql://postgres.${REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres` },
      { PLAZA_ONLINE_DATABASE_URL: 'not a url' },
    ],
    database_url_host: [
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@db.${REF}.supabase.co:6543/postgres`) },
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@aws-1-us-east-1.pooler.supabase.com:6543/postgres`) },
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@127.0.0.1:6543/postgres`) },
    ],
    database_url_pooler: [
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres`) },
      { PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/other`) },
    ],
    database_url_project: [
      { PLAZA_ONLINE_DATABASE_URL: url('postgres.abcdefghijklmnopqrst:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres') },
      { PLAZA_ONLINE_DATABASE_URL: url('postgres:x@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres') },
    ],
    database_url_password: [{ PLAZA_ONLINE_DATABASE_URL: url(`postgres.${REF}@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres`) }],
  };
  for (const [code, variants] of Object.entries(cases)) {
    for (const extra of variants) {
      assert.equal(reason(extra), code, JSON.stringify(extra));
      assert.equal(online.entryBlocked(env(extra)), code);
      assert.throws(() => plazaConfig(env(extra)), new RegExp(code));
    }
  }
});

test('production deployments ignore leaked online settings instead of switching databases', () => {
  const prod = env({ VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', PLAZA_STAGE1_TEST: undefined });
  const errors = [], original = console.error;
  console.error = message => errors.push(message);
  try { assert.equal(online.entryBlocked(prod), null); } finally { console.error = original; }
  assert.equal(errors.length, 1);
  assert.equal(online.active(prod), false);
  assert.equal(plazaConfig(prod), null);
  assert.equal(online.onlineGate({}).reason, 'not_requested');
});

test('a Vercel run of this branch that is not production stops when the online flag is missing', () => {
  for (const extra of [{ PLAZA_ONLINE_TEST: undefined }, { PLAZA_ONLINE_TEST: 'yes' }, { PLAZA_ONLINE_TEST: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined }]) {
    assert.equal(online.requested(env(extra)), true);
    assert.ok(online.entryBlocked(env({ ...extra, PLAZA_ONLINE_DATABASE_URL: undefined })));
    assert.throws(() => plazaConfig(env({ ...extra, PLAZA_ONLINE_DATABASE_URL: undefined })));
  }
  assert.equal(online.requested({ VERCEL: '1', VERCEL_ENV: 'production', DATABASE_URL: 'x' }), false);
  assert.equal(online.requested({ DATABASE_URL: 'postgres://u@127.0.0.1/plaza_test_x' }), false);
});

test('online plaza config always uses the database photo store and the synthetic kit', () => {
  const config = plazaConfig(env());
  assert.equal(config.online, true);
  assert.equal(config.photoStore, 'pg');
  assert.equal(config.storageRoot, null);
  assert.equal(config.syntheticKit, true);
  assert.deepEqual([config.stage2, config.stage3, config.stage4, config.stage5], [true, true, true, true]);
  // Local mode keeps the file store unless the DB store is asked for explicitly.
  const local = { PLAZA_STAGE1_TEST: '1', DATABASE_URL: 'postgres://u@127.0.0.1/plaza_test_x', PLAZA_TEST_ID: crypto.randomUUID(), PLAZA_TEST_STORAGE_DIR: '/tmp/plaza-x' };
  assert.equal(plazaConfig(local).photoStore, 'fs');
  assert.equal(plazaConfig({ ...local, PLAZA_PHOTO_STORE: 'pg' }).photoStore, 'pg');
  assert.throws(() => plazaConfig({ ...local, PLAZA_PHOTO_STORE: 's3' }));
});

test('online record QR uses the checked Preview origin, never a port or supplied host', () => {
  const id = crypto.randomUUID();
  const url = new URL(cardUrl(id, '443@outside.invalid', env()));
  assert.equal(url.origin, 'https://aiapp-git-feat-plaza-online-test-20261005-themonsteredu.vercel.app');
  assert.equal(url.hash, `#/plaza-record/${id}`);
  assert.throws(() => cardUrl(id, 3999, env({ PLAZA_ONLINE_DATABASE_URL: undefined })));
});

test('blocked online deployment answers 503 for every API and reports only the reason code', async () => {
  const handle = online.blockedApi('database_url_missing');
  const call = async (method, pathname) => {
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
    await handle({ method }, res, pathname);
    return res;
  };
  const me = await call('GET', '/api/me');
  assert.equal(me.status, 503);
  assert.equal(me.body.code, 'plaza_online_not_ready');
  const status = await call('GET', '/api/deployment-status');
  assert.deepEqual([status.status, status.body], [200, { mode: 'plaza-online-test', ready: false, reason: 'database_url_missing' }]);
  assert.equal((await call('POST', '/api/login')).status, 503);
});

test('a blocked online entry point never loads the API or opens the database module', () => {
  for (const [entry, extra] of [['server.js', {}], ['api/index.js', {}], ['api/index.js', { PLAZA_ONLINE_TEST: undefined }]]) {
    const script = `const Module=require('node:module'),load=Module._load;Module._load=function(r,...a){if(/lib[\\\\/](api|db)(\\.js)?$/.test(r))throw new Error('loaded '+r);return load.call(this,r,...a)};
      require(${JSON.stringify(path.join(root, entry))});process.stdout.write('not loaded');process.exit(0);`;
    const childEnv = Object.fromEntries(Object.entries({ ...env({ PLAZA_ONLINE_DATABASE_URL: undefined, ...extra }), PORT: '0', PATH: process.env.PATH }).filter(([, v]) => v !== undefined));
    assert.equal(execFileSync(process.execPath, ['-e', script], { env: childEnv, cwd: root, encoding: 'utf8' }), 'not loaded', entry);
  }
});

test('lib/db.js in online mode refuses to start with a bad test URL and never falls back to DATABASE_URL', () => {
  const script = `try{require(${JSON.stringify(path.join(root, 'lib/db.js'))});process.stdout.write('loaded')}catch(e){process.stdout.write(e.message)}`;
  const bad = { ...env({ PLAZA_ONLINE_DATABASE_URL: undefined }), PATH: process.env.PATH };
  assert.match(execFileSync(process.execPath, ['-e', script], { env: bad, cwd: root, encoding: 'utf8' }), /database_url_missing/);
});

test('a JPEG that is too small once its metadata is removed is refused the same way by both stores', () => {
  const { jpegInput } = require('../lib/plaza-storage');
  const segment = (marker, body) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([0, body.length + 2]), Buffer.from(body)]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), segment(0xe0, new Array(14).fill(0)),
    segment(0xc0, [8, 0, 16, 0, 16, 1, 1, 0x11, 0]), segment(0xda, [1, 1, 0, 0, 63, 0]), Buffer.from([0, 0, 0xff, 0xd9])]);
  assert.equal(jpeg.length, 47);
  assert.throws(() => jpegInput(`data:image/jpeg;base64,${jpeg.toString('base64')}`), e => e.status === 400);
});
