'use strict';
// Online plaza test mode: ONE Vercel Preview branch talking to ONE disposable Supabase project.
// Nothing here reads DATABASE_URL. The test database URL has its own variable so that an
// inherited Preview/production DATABASE_URL can never be picked up by accident.
const path = require('node:path');
// The exact parser pg itself uses for connection strings (pg's own dependency, not a new one).
const { parse } = require(require.resolve('pg-connection-string', { paths: [path.dirname(require.resolve('pg'))] }));

const PRODUCTION_REF = 'vypnobpmyadtcvxhtagn';
const ONLINE_BRANCH = 'feat/plaza-online-test-20261005';
const TEST_REF = 'yxnenjtmuvdlfxnwxecp';
const POOLER_HOST = /^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STAGES = ['PLAZA_STAGE1_TEST', 'PLAZA_STAGE2_TEST', 'PLAZA_STAGE3_TEST', 'PLAZA_STAGE4_TEST', 'PLAZA_STAGE5_TEST'];
// libpq-style variables that pg would merge into the connection.
const PG_OVERRIDES = ['PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE', 'PGOPTIONS', 'PGSERVICE'];

// This branch is never merged. Any non-production Vercel run of it counts as a request, so a
// Preview with a missing or misspelled flag stops instead of using the inherited DATABASE_URL.
const requested = (env = process.env) => env.PLAZA_ONLINE_TEST === '1' || (env.VERCEL === '1' && env.VERCEL_ENV !== 'production');
// A production deployment never enters online mode, even if the flag leaks into its settings.
const ignoredInProduction = (env = process.env) => requested(env) && env.VERCEL_ENV === 'production';

// Returns { ok: true, ... } or { ok: false, reason }. Reasons are fixed codes without secrets.
function onlineGate(env = process.env) {
  const no = reason => ({ ok: false, reason });
  if (!requested(env) || ignoredInProduction(env)) return no('not_requested');
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview') return no('not_preview');
  if (env.VERCEL_TARGET_ENV !== undefined && env.VERCEL_TARGET_ENV !== 'preview') return no('not_preview');
  if (env.VERCEL_GIT_COMMIT_REF !== ONLINE_BRANCH) return no('branch');
  if (!/^[a-z0-9-]{1,63}\.vercel\.app$/.test(env.VERCEL_BRANCH_URL || '')) return no('branch_url');
  for (const name of STAGES) if (env[name] !== '1') return no('stage_flags');
  if (env.PLAZA_SYNTHETIC_KIT !== '1') return no('synthetic_kit');
  if (!UUID.test(env.PLAZA_TEST_ID || '')) return no('test_id');
  if (env.PLAZA_TEST_STORAGE_DIR) return no('file_storage');
  if (env.SUPABASE_URL || env.SUPABASE_SERVICE_KEY) return no('media_storage');
  if (PG_OVERRIDES.some(name => env[name] !== undefined)) return no('pg_override');
  // The preview is public: the seeded superadmin must not get the documented default (lib/db.js).
  if (typeof env.SUPERADMIN_PASSWORD !== 'string' || env.SUPERADMIN_PASSWORD.length < 12 || env.SUPERADMIN_PASSWORD === 'ChangeMe123!') return no('superadmin_password');
  const raw = env.PLAZA_ONLINE_DATABASE_URL;
  if (!raw) return no('database_url_missing');
  if (raw.includes(PRODUCTION_REF)) return no('database_url_production');
  let url, parsed;
  try { url = new URL(raw); parsed = parse(raw); } catch { return no('database_url_format'); }
  // Query parameters would override host, user or ssl inside pg. Allow none.
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash) return no('database_url_format');
  if (!POOLER_HOST.test(parsed.host || '') || parsed.host !== url.hostname) return no('database_url_host');
  if (String(parsed.port) !== '6543' || parsed.database !== 'postgres') return no('database_url_pooler');
  // The pooler host is shared by every project in the region. The project is the user suffix.
  const user = String(parsed.user || '');
  const at = user.lastIndexOf('.');
  if (at < 1 || user.slice(at + 1) !== TEST_REF || !/^[a-z_][a-z0-9_]*$/.test(user.slice(0, at))) return no('database_url_project');
  if (!parsed.password) return no('database_url_password');
  return {
    ok: true,
    databaseUrl: raw,
    projectRef: TEST_REF,
    testId: env.PLAZA_TEST_ID,
    publicOrigin: `https://${env.VERCEL_BRANCH_URL}`,
  };
}

// Entry points call this before lib/api.js (and so lib/db.js) is loaded.
function entryBlocked(env = process.env) {
  if (!requested(env)) return null;
  if (ignoredInProduction(env)) {
    console.error('PLAZA_ONLINE_TEST is ignored in production deployments.');
    return null;
  }
  const gate = onlineGate(env);
  return gate.ok ? null : gate.reason;
}

const active = (env = process.env) => requested(env) && !ignoredInProduction(env) && onlineGate(env).ok;

function blockedApi(reason) {
  return async function handleApi(req, res, pathname) {
    const status = req.method === 'GET' && pathname === '/api/deployment-status';
    res.writeHead(status ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    });
    res.end(JSON.stringify(status
      ? { mode: 'plaza-online-test', ready: false, reason }
      : { code: 'plaza_online_not_ready', reason, error: '광장 온라인 시험 설정을 확인하지 못해 멈춰 두었습니다. 관리자에게 알려 주세요.' }));
  };
}

module.exports = { PRODUCTION_REF, ONLINE_BRANCH, TEST_REF, requested, ignoredInProduction, onlineGate, entryBlocked, active, blockedApi };
