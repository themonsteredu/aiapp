'use strict';
const path = require('node:path');
const plazaOnline = require('./plaza-online');

// Plaza development remains confined to an explicit, disposable test environment:
// a local plaza_test_ database, or the single online test branch checked in lib/plaza-online.js.
// No production/Preview URL or existing media bucket is an implicit fallback.
function plazaConfig(env = process.env) {
  if (plazaOnline.requested(env) && !plazaOnline.ignoredInProduction(env)) return onlineConfig(env);
  if (env.PLAZA_STAGE1_TEST !== '1') return null;
  let db;
  try { db = new URL(env.DATABASE_URL); } catch { throw new Error('광장 시험 DB 설정을 확인해 주세요.'); }
  if (env.VERCEL || !['localhost', '127.0.0.1', '[::1]'].includes(db.hostname)
      || !/^\/plaza_test_[a-z0-9_]+$/.test(db.pathname)
      || !/^[0-9a-f-]{36}$/.test(env.PLAZA_TEST_ID || '')) {
    throw new Error('광장 시험 기능은 별도 로컬 시험 DB에서만 실행할 수 있습니다.');
  }
  const root = env.PLAZA_TEST_STORAGE_DIR;
  const repo = path.resolve(__dirname, '..');
  if (!root || !path.isAbsolute(root) || path.resolve(root) === repo || path.resolve(root).startsWith(repo + path.sep)) {
    throw new Error('광장 시험 사진 폴더는 저장소 밖의 비공개 경로여야 합니다.');
  }
  if(env.PLAZA_STAGE3_TEST==='1' && env.PLAZA_STAGE2_TEST!=='1')throw new Error('3단계 시험에는 2단계 기능이 필요합니다.');
  if(env.PLAZA_STAGE4_TEST==='1' && env.PLAZA_STAGE3_TEST!=='1')throw new Error('4단계 시험에는 3단계 기능이 필요합니다.');
  if(env.PLAZA_STAGE5_TEST==='1' && env.PLAZA_STAGE4_TEST!=='1')throw new Error('5단계 시험에는 4단계 기능이 필요합니다.');
  // The DB-backed photo store can also be exercised locally, so it is tested before going online.
  if (env.PLAZA_PHOTO_STORE !== undefined && env.PLAZA_PHOTO_STORE !== 'pg') throw new Error('광장 사진 저장소 설정을 확인해 주세요.');
  return { testId: env.PLAZA_TEST_ID, database: db.pathname.slice(1), storageRoot: path.resolve(root), stage2: env.PLAZA_STAGE2_TEST === '1', stage3: env.PLAZA_STAGE3_TEST === '1',stage4:env.PLAZA_STAGE4_TEST==='1',stage5:env.PLAZA_STAGE5_TEST==='1',
    online: false, photoStore: env.PLAZA_PHOTO_STORE === 'pg' ? 'pg' : 'fs', syntheticKit: env.PLAZA_SYNTHETIC_KIT === '1' };
}

// Online test mode: every stage on, photos only in the test database, synthetic kit only.
function onlineConfig(env) {
  const gate = plazaOnline.onlineGate(env);
  if (!gate.ok) throw new Error(`광장 온라인 시험 설정을 확인해 주세요 (${gate.reason}).`);
  return { testId: gate.testId, database: 'postgres', storageRoot: null, stage2: true, stage3: true, stage4: true, stage5: true,
    online: true, projectRef: gate.projectRef, publicOrigin: gate.publicOrigin, photoStore: 'pg', syntheticKit: true };
}
module.exports = { plazaConfig };
