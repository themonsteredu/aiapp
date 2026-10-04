'use strict';
const path = require('node:path');

// Plaza development remains confined to an explicit, disposable local test environment.
// No production/Preview URL or existing media bucket is an implicit fallback.
function plazaConfig(env = process.env) {
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
  return { testId: env.PLAZA_TEST_ID, database: db.pathname.slice(1), storageRoot: path.resolve(root), stage2: env.PLAZA_STAGE2_TEST === '1', stage3: env.PLAZA_STAGE3_TEST === '1',stage4:env.PLAZA_STAGE4_TEST==='1',stage5:env.PLAZA_STAGE5_TEST==='1' };
}
module.exports = { plazaConfig };
