'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {plazaConfig}=require('../lib/plaza-config');
async function setup(){
  const config=plazaConfig();if(!config?.stage4)throw new Error('4단계 별도 로컬 시험 환경이 필요합니다.');
  const fixture=await require('./plaza-stage3-setup').setup(),db=require('../lib/db');
  await db.withTransaction(async tx=>{
    await tx.q("SELECT set_config('plaza.test_id',$1,true)",[config.testId]);
    await tx.q(await fs.readFile(path.join(__dirname,'../db/plaza-stage4.sql'),'utf8'));
    const username=`plaza4-admin-${crypto.randomBytes(6).toString('hex')}`,password=crypto.randomBytes(24).toString('hex');
    const user=await tx.one("INSERT INTO users(username,password_hash,name,role,agreed_version,must_change_password) VALUES($1,$2,'4단계 시험 관리자','admin',1,false) RETURNING id",[username,require('../lib/password').hashPassword(password)]);
    fixture.admin={id:user.id,username,password};
  });
  await fs.writeFile(path.join(config.storageRoot,'fixture.json'),JSON.stringify(fixture),{mode:0o600});
  return fixture;
}
module.exports={setup};
if(require.main===module)setup().then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});
