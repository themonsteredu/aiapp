'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {plazaConfig}=require('../lib/plaza-config');
async function setup() {
  const config=plazaConfig();if(!config?.stage3)throw new Error('PLAZA_STAGE3_TEST=1인 별도 로컬 시험 환경만 준비합니다.');
  const fixture=await require('./plaza-stage2-setup').setup(),db=require('../lib/db');
  await db.withTransaction(async tx=>{
    await tx.q("SELECT set_config('plaza.test_id',$1,true)",[config.testId]);
    await tx.q(await fs.readFile(path.join(__dirname,'../db/plaza-stage3.sql'),'utf8'));
  });
  return fixture;
}
module.exports={setup};
if(require.main===module)setup().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
