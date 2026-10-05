'use strict';
// Explicit local-only test setup. Never imported by server startup.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { plazaConfig } = require('../lib/plaza-config');

async function setup() {
  const config = plazaConfig();
  if (!config || process.env.PLAZA_SETUP_CONFIRM !== 'disposable-local-test') throw new Error('별도 빈 시험 DB를 지정하고 PLAZA_SETUP_CONFIRM=disposable-local-test로 실행해 주세요.');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const tables = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
    if (tables.rows[0].n) throw new Error('비어 있는 새 시험 DB에서만 준비할 수 있습니다.');
    await fs.mkdir(config.storageRoot, { recursive: false, mode: 0o700 });
    await fs.writeFile(path.join(config.storageRoot,'.plaza-test-store.json'),JSON.stringify({ testId:config.testId,purpose:'stage1-local-test' }),{mode:0o600});
  } finally { client.release(); await pool.end(); }
  const db = require('../lib/db');
  await db.ready();
  // Minimal fake Career Log schema. No central school accounts are created or copied.
  await db.q(await fs.readFile(path.join(__dirname,'../db/plaza-test-career-log.sql'),'utf8'));
  await db.q(await fs.readFile(path.join(__dirname,'../db/job-career-log.sql'),'utf8'));
  await db.withTransaction(async tx => {
    await tx.q("SELECT set_config('plaza.test_id',$1,true)",[config.testId]);
    await tx.q(await fs.readFile(path.join(__dirname,'../db/plaza-stage1.sql'),'utf8'));
    // Same DB-backed photo store as the online test, exercised locally first.
    if (config.photoStore === 'pg') await tx.q(await fs.readFile(path.join(__dirname,'../db/plaza-online-storage.sql'),'utf8'));
  });
  const { hashPassword } = require('../lib/password');
  const staffPassword = crypto.randomBytes(18).toString('base64url');
  const staff = await db.one(`INSERT INTO users (username,password_hash,name,role,agreed_version,must_change_password)
    VALUES ('plaza-test-teacher',$1,'시험 강사','instructor',1,false) RETURNING id`,[hashPassword(staffPassword)]);
  const deck = await db.one(`INSERT INTO decks(title,description,created_by,kind,external_url,published)
    VALUES ('조향사 광장','1단계 시험 자료 · 실제 키트 확인 대기',$1,'link','https://job.moakit.ai/class',true) RETURNING id`,[staff.id]);
  const cs = await db.one(`INSERT INTO class_sessions(code,title,created_by,instructor_id,expires_at)
    VALUES($1,'광장 연결 시험',$2,$2,now()+interval '12 hours') RETURNING id,code`,[String(crypto.randomInt(100000,1000000)),staff.id]);
  await db.q('INSERT INTO session_items(session_id,deck_id) VALUES($1,$2)',[cs.id,deck.id]);
  const programId=crypto.randomUUID(),roomId=crypto.randomUUID();
  const card={program_key:'perfumer-gypsum',version:1,materials_status:'키트 목록 확인 대기',materials:[],customers:[
    {id:'gentle',title:'강한 향이 부담스러운 손님'},{id:'words',title:'향을 말로 이해하고 싶은 손님'},{id:'gift',title:'선물할 사람의 취향을 모르는 손님'}]};
  await db.q(`INSERT INTO plaza_program_versions(id,program_key,version,deck_id,card,review_status) VALUES($1,'perfumer-gypsum',1,$2,$3,'test-only')`,[programId,deck.id,card]);
  await db.q('INSERT INTO plaza_rooms(id,class_session_id,deck_id,program_version_id,seat_count) VALUES($1,$2,$3,$4,30)',[roomId,cs.id,deck.id,programId]);
  // Only ephemeral credentials; never print or commit the password.
  const fixture={roomId,deckId:deck.id,classSessionId:cs.id,code:cs.code,teacher:{username:'plaza-test-teacher',password:staffPassword,id:staff.id}};
  await fs.writeFile(path.join(config.storageRoot,'fixture.json'),JSON.stringify(fixture),{mode:0o600});
  console.log(JSON.stringify({database:config.database,roomId,classSessionId:cs.id,deckId:deck.id,fixture:'private test storage/fixture.json'}));
  return fixture;
}
module.exports = { setup };
if (require.main === module) setup().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
