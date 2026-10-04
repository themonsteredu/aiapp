'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {plazaConfig}=require('../lib/plaza-config');
const {perfumerCard}=require('../lib/plaza-perfumer-card');
const {slidesInput}=require('../lib/plaza-program');
async function setup() {
  const config=plazaConfig();if(!config?.stage2)throw new Error('PLAZA_STAGE2_TEST=1인 별도 로컬 시험 환경만 준비합니다.');
  const fixture=await require('./plaza-stage1-setup').setup(),db=require('../lib/db');
  await db.withTransaction(async tx=>{
    await tx.q("SELECT set_config('plaza.test_id',$1,true)",[config.testId]);
    await tx.q(await fs.readFile(path.join(__dirname,'../db/plaza-stage2.sql'),'utf8'));
    const programId=crypto.randomUUID(),card=perfumerCard({synthetic:process.env.PLAZA_SYNTHETIC_KIT==='1'});
    await tx.q("INSERT INTO plaza_program_versions(id,program_key,version,deck_id,card,review_status) VALUES($1,$2,2,$3,$4,'test-only')",[programId,card.program_key,fixture.deckId,card]);
    await tx.q('UPDATE plaza_rooms SET program_version_id=$1 WHERE id=$2',[programId,fixture.roomId]);
    const materialPath=process.env.PLAZA_TEACHER_MATERIAL_PATH;
    if(materialPath) {
      const file=await fs.realpath(materialPath),repo=path.resolve(__dirname,'..');
      if(file===repo||file.startsWith(repo+path.sep)||(await fs.stat(file)).size>160000)throw new Error('교안은 저장소 밖의 비공개 파일이어야 합니다.');
      const content=slidesInput(JSON.parse(await fs.readFile(file,'utf8')));
      await tx.q('INSERT INTO plaza_teacher_materials(program_version_id,content,created_by) VALUES($1,$2,$3)',[programId,content,fixture.teacher.id]);
    }
  });
  return fixture;
}
module.exports={setup};
if(require.main===module)setup().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
