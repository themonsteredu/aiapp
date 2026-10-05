'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {plazaConfig}=require('../lib/plaza-config');
const {client,ok,prepare,advance}=require('./plaza-rehearsal');
const uuid=()=>crypto.randomUUID();
function installFaults(){
  const faults={remove:null,photo:null,started:null,resume:null};
  const mod=require('../lib/plaza-storage');
  for(const name of ['localTestStorage','pgTestStorage']){const original=mod[name];mod[name]=(...args)=>{const store=original(...args);return {...store,
    async removeVerified(key){if(faults.remove==='fail')throw new Error('synthetic delete failure');if(faults.remove==='lie')return {verified:true};return store.removeVerified(key);},
    async put(key,image){await store.put(key,image);if(faults.photo==='pause'){faults.started?.();await new Promise(r=>{faults.resume=r;});}}
  };};}
  return faults;
}
async function verify({base='http://127.0.0.1:3999',fixture,faults}={}) {
  const config=plazaConfig();if(!config?.stage4||!faults)throw new Error('별도 4단계 시험 환경이 필요합니다.');
  const db=require('../lib/db');assert.equal((await db.one('SELECT test_id FROM plaza_environment WHERE database_name=current_database()')).test_id,config.testId);
  let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;console.log('PASS',label);};
  // Photo objects are files locally, or rows in plaza_photo_blobs with PLAZA_PHOTO_STORE=pg / online.
  // A DB store has no temporary names and rejects foreign names, so those two cases differ by store.
  const pgStore=config.photoStore==='pg',{digest}=require('../lib/career-log');
  const plant=async(name,buffer)=>pgStore?(/\.tmp$|\.txt$/.test(name)?null:db.q('INSERT INTO plaza_photo_blobs(object_key,data,digest,bytes) VALUES($1,$2,$3,$4)',[name,buffer,digest(buffer),buffer.length])):fs.writeFile(path.join(config.storageRoot,name),buffer);
  const present=async name=>pgStore?!!await db.one('SELECT 1 FROM plaza_photo_blobs WHERE object_key=$1',[name]):!!await fs.stat(path.join(config.storageRoot,name)).catch(()=>null);
  const admin=client(base),teacher=client(base),outsider=client(base),room=`/api/plaza/rooms/${fixture.roomId}`,maint=room+'/retention';
  await ok(admin.request('POST','/api/login',fixture.admin));await ok(teacher.request('POST','/api/login',fixture.teacher));
  const student=client(base);await ok(student.request('POST','/api/join',{code:fixture.code,name:'시험 안내 확인'}));
  const entry={mode:'new',seat_order:30,record_choice:'no-record',photo_allowed:false,notice_version:'stage4-test-1',attempt_id:uuid()};
  check((await student.request('POST',room+'/enter',entry)).status===409,'정책 미등록 입장 차단');
  check((await student.request('POST','/api/career-log/start',{mode:'new'})).status===409,'광장 선택 전 일반 기록 번호 생성 차단');
  check((await teacher.request('GET',maint)).status===403,'담당 강사도 관리자 파기 경로 접근 불가');
  check((await student.request('GET','/api/plaza/retention')).status===403,'학생 파기 목록 접근 불가');
  check((await outsider.request('GET',maint)).status===401,'익명 파기 목록 접근 불가');
  check((await admin.request('POST',maint+'/policy',{photo_hours:1,activity_hours:1,audit_hours:0,confirm_test_only:true})).status===400,'운영 이력 기한 선후 관계 검사');
  const policy={photo_hours:1,activity_hours:2,audit_hours:3,confirm_test_only:true};
  await ok(admin.request('POST',maint+'/policy',policy));
  check((await ok(admin.request('POST',maint+'/policy',policy))).duplicate,'정책 등록 응답 유실 재시도');
  check((await admin.request('POST',maint+'/policy',{...policy,photo_hours:0})).status===409,'확정 정책 변경 차단');
  check((await student.request('POST',room+'/enter',{mode:'new',seat_order:30,attempt_id:uuid()})).status===400,'기록·사진 선택 생략 차단');
  const group=await prepare({base,fixture,count:4,choices:[{record_choice:'no-record',photo_allowed:false},{record_choice:'no-record',photo_allowed:true},{record_choice:'record',photo_allowed:true},{record_choice:'no-record',photo_allowed:true}]}),{people}=group;
  const mine=p=>ok(p.client.request('GET',room+'/mine'));
  const info=()=>ok(teacher.request('GET',room+'/teacher'));
  const row=async seat=>(await info()).participants.find(p=>p.seat_order===seat);
  const count=async table=>(await db.one(`SELECT count(*)::int AS n FROM ${table}`)).n;
  check(await count('career_log.students')===1&&await count('career_log.job_identities')===1,'비기록 2명은 장기 학생 UUID·연결 0개');
  check(people[0].client.cookies.get('job_career_access')===''&&people[0].client.cookies.get('job_career_resume')==='','비기록 입장은 이전 기기 기록 쿠키 제거');
  check((await people[0].client.request('POST','/api/career-log/start',{mode:'new'})).status===409,'입장 후 일반 기록 생성 우회 차단');
  check(!(await ok(people[0].client.request('GET','/api/career-log/profile'))).canResume,'비기록 학생에게 이전 기록 이어가기 미노출');
  check((await people[0].client.request('POST',room+'/record-preview',{})).status===409,'비기록 접수 사본 생성 차단');
  check((await people[0].client.request('POST',room+'/record',{attempt_id:uuid()})).status===409,'비기록 최종 저장 우회 차단');
  check((await people[0].client.request('POST',room+'/finish',{attempt_id:uuid()})).status===409,'활동 전 비기록 완료 차단');
  const p1=await row(1);
  check((await teacher.request('POST',room+'/photos',{capture_id:uuid(),participant_id:p1.id,target_version:p1.target_version})).status===409,'사진 미선택 학생 촬영 예약 차단');
  // A no-record participant can recover on another device without gaining a career identity.
  const issued=await ok(teacher.request('POST',room+'/reissue',{participant_id:p1.id,connection_version:p1.connection_version,confirm:true,attempt_id:uuid()}));
  const replacement=client(base);await ok(replacement.request('POST','/api/join',{code:fixture.code,name:'시험 기기 교체'}));
  const claim={code:issued.code,attempt_id:uuid()};await ok(replacement.request('POST',room+'/claim',claim,{keepCookies:false}));
  const recovered=await ok(replacement.request('POST',room+'/claim',claim));people[0].client=replacement;
  check(recovered.privacy.record_choice==='no-record'&&recovered.duplicate&&await count('career_log.students')===1,'기기 교체·응답 유실 후 비기록 선택과 UUID 미생성 유지');
  const dataUrl=await fs.readFile(path.join(__dirname,'../test/fixtures/plaza-photo.txt'),'utf8');
  const buffer=require('../lib/plaza-storage').jpegInput(dataUrl).buffer;
  async function capture(seat,upload=true){const p=await row(seat),id=uuid();await ok(teacher.request('POST',room+'/photos',{capture_id:id,participant_id:p.id,target_version:p.target_version}));if(upload)await ok(teacher.request('PUT',room+'/photos/'+id,{data_url:dataUrl,target_version:p.target_version}));const o=await db.one('SELECT object_key FROM plaza_photo_objects WHERE photo_id=$1',[id]);return {id,key:o.object_key,target_version:p.target_version};}
  const old=await capture(2),fresh=await capture(2),pending=await capture(2,false);
  const temp=`${pending.key}.${uuid()}.tmp`;await plant(temp,buffer);
  check((await people[1].client.request('GET',room+'/photos/'+fresh.id)).status===200,'비기록 학생도 별도 사진 허용 시 전시 가능');
  const p2=await row(2);
  check((await teacher.request('POST',room+'/photo-move',{capture_id:fresh.id,participant_id:p1.id,source_version:p2.target_version,target_version:p1.target_version,confirm:true,attempt_id:uuid()})).data.code==='photo_declined','사진 미동의 대상으로 옮기기 차단');
  const withdrawal={photo_allowed:false,version:(await mine(people[1])).privacy.privacy_version,attempt_id:uuid()};
  faults.remove='fail';const failed=await ok(people[1].client.request('POST',room+'/photo-choice',withdrawal));
  check(failed.purge.status==='retry'&&!failed.photo_allowed,'실파일 삭제 실패는 재시도 상태');
  check((await people[1].client.request('GET',room+'/photos/'+fresh.id)).status!==200,'삭제 실패 중에도 사진 조회 즉시 차단');
  check(await present(old.key),'실패 파일은 성공으로 표시하지 않음');
  faults.remove='lie';const lie=await ok(people[1].client.request('POST',room+'/photo-choice',withdrawal));
  check(lie.purge.status==='retry','삭제 성공 응답만으로 완료하지 않고 실제 부재 재확인');
  faults.remove=null;const removed=await ok(people[1].client.request('POST',room+'/photo-choice',withdrawal));
  check(removed.purge.status==='verified'&&removed.purge.items.length===3,'현재본·재촬영 이전본·예약 임시본 파기 검증');
  for(const file of [old.key,fresh.key,temp])check(!await present(file),'파일 실제 부재 '+file.slice(-4));
  check(removed.purge.whole_system_complete===false,'백업·원본 미확인 상태에서 전체 파기 완료 금지');
  await db.q('UPDATE plaza_participants SET photo_allowed=true WHERE id=$1',[p2.id]);
  check(!(await mine(people[1])).privacy.photo_allowed,'선택 전 DB 복원에도 사진 철회 유지');
  check((await teacher.request('POST',room+'/photos',{capture_id:uuid(),participant_id:p2.id,target_version:(await row(2)).target_version})).status===409,'DB 복원 뒤 새 촬영 우회 차단');
  await plant(old.key,buffer);
  const stores=require('../lib/plaza-storage'),storage=pgStore?stores.pgTestStorage(config,db):stores.localTestStorage(config);
  await assert.rejects(storage.read(old.key),e=>e.status===410);checks++;
  await ok(people[1].client.request('POST',room+'/photo-choice',withdrawal));
  check(await storage.absent(old.key),'이미 검증한 삭제도 복원된 파일을 재삭제');
  // Upload and withdrawal race: deletion cannot pass the transaction holding a live writer.
  const race=await capture(3,false),p3before=await mine(people[2]);faults.photo='pause';
  const started=new Promise(r=>{faults.started=r;});
  const upload=teacher.request('PUT',room+'/photos/'+race.id,{data_url:dataUrl,target_version:race.target_version});await started;
  let withdrawalDone=false;
  const concurrent=people[2].client.request('POST',room+'/photo-choice',{photo_allowed:false,version:p3before.privacy.privacy_version,attempt_id:uuid()}).then(r=>{withdrawalDone=true;return r;});
  await new Promise(r=>setTimeout(r,25));check(!withdrawalDone,'업로드 중 파기 완료 처리 선행 금지');
  faults.photo=null;faults.resume();await ok(upload);await ok(concurrent);
  check(await storage.absent(race.key),'지연 업로드도 파기 뒤 파일 재생성 없음');
  const retained=await capture(4);
  const state=async name=>{const r=await info();return ok(teacher.request('POST',room+'/state',{state:name,version:r.room.version,participant_ids:r.participants.map(p=>p.id),reason:'가짜 시험 종료'}));};
  await state('paused');await state('returning');await advance(group);await state('exchange');await advance(group);await state('reflection');await advance(group);
  check((await mine(people[0])).privacy.activity_completed_at&&(await mine(people[1])).privacy.activity_completed_at,'비기록 학생도 구상·제작·교류·성찰 후 완료');
  check(await count('career_log.records')===1&&await count('plaza_record_receipts')===1,'기록 선택 학생만 원본·최종 접수 생성');
  const completion={attempt_id:uuid()},complete1=await ok(people[0].client.request('POST',room+'/finish',completion)),complete2=await ok(people[0].client.request('POST',room+'/finish',completion));
  check(complete1.activity_completed_at===complete2.activity_completed_at&&complete2.duplicate,'비기록 완료 중복 요청 한 번');
  check((await people[0].client.request('PUT',room+'/activity',{kind:'reflection',version:(await mine(people[0])).activity.version,answers:['수정','수정','수정'],attempt_id:uuid()})).status===409,'비기록 완료 후 성찰 고정');
  const counts=(await info()).counts;check(counts.no_record===3&&counts.activity_completed===3&&counts.record_missing===0,'비기록 학생은 진로기록 미완료 인원에서 제외');
  // Other class and orphan safety. Retention keeps immutable career records byte-for-byte.
  const originalRecords=JSON.stringify(await db.q('SELECT * FROM career_log.records ORDER BY id'));
  const secondId=uuid(),program=await db.one('SELECT program_version_id FROM plaza_rooms WHERE id=$1',[fixture.roomId]);
  const cs2=await db.one("INSERT INTO class_sessions(code,title,created_by,instructor_id,expires_at) VALUES($1,'별도 시험 수업',$2,$2,now()+interval '12 hours') RETURNING id",[String(crypto.randomInt(100000,1000000)),fixture.teacher.id]);
  await db.q('INSERT INTO plaza_rooms(id,class_session_id,deck_id,program_version_id,seat_count) VALUES($1,$2,$3,$4,30)',[secondId,cs2.id,fixture.deckId,program.program_version_id]);
  check((await ok(admin.request('GET',maint+'/preview'))).scopes.length===0,'열린 수업 조기 파기 없음');
  await state('closed');
  check((await ok(admin.request('GET',maint+'/preview'))).scopes.length===0,'종료 직후 보관 기한 전 파기 없음');
  await db.q("UPDATE plaza_rooms SET closed_at=now()-interval '4 hours' WHERE id=$1",[fixture.roomId]);
  await db.q("UPDATE class_sessions SET expires_at=now()-interval '1 minute' WHERE id=$1",[fixture.classSessionId]);
  await db.q('UPDATE decks SET published=false WHERE id=$1',[fixture.deckId]);
  const plan=await ok(admin.request('GET',maint+'/preview'));
  check(plan.scopes.join(',')==='photos,activities,audit','종료·만료·자료 잠금에도 관리자 파기 가능');
  check((await admin.request('POST',maint+'/purge',{attempt_id:uuid(),digest:'stale',confirm:true})).status===409,'미리보기 변조·오래된 목록 파기 거절');
  // Snapshot representative participant/activity rows before deletion; simulate an old DB restore later.
  const snapshot={};for(const table of ['plaza_participants','plaza_photos','plaza_photo_objects','plaza_drafts','plaza_activities','plaza_record_receipts'])snapshot[table]=await db.q(`SELECT * FROM ${table}`);
  const purgeBody={attempt_id:uuid(),digest:plan.digest,confirm:true};faults.remove='fail';
  const interrupted=await ok(admin.request('POST',maint+'/purge',purgeBody));
  check(interrupted.status==='retry'&&await present(retained.key),'수업 전체 파기에도 파일 실패를 보존하고 재시도 표시');
  check((await teacher.request('GET',room+'/teacher')).status===410,'수업 파기 실패 중 일반 조회 차단');
  faults.remove=null;const purged=await ok(admin.request('POST',maint+`/jobs/${interrupted.id}/retry`,{}));
  check(await storage.absent(retained.key),'관리자 재시도로 수업 사진 실파일 파기');
  check(purged.status==='verified'&&!purged.whole_system_complete,'광장 범위 삭제 검증과 전체 시스템 범위 구분');
  for(const table of ['plaza_participants','plaza_drafts','plaza_activities','plaza_ai_runs','plaza_visits','plaza_record_receipts','plaza_write_receipts','plaza_reissues','plaza_device_grants','plaza_events','plaza_operations'])check(await count(table)===0,table+' 실제 삭제');
  check(JSON.stringify(await db.q('SELECT * FROM career_log.records ORDER BY id'))===originalRecords,'기존 진로기록 원본 바이트 유지');
  check(!!await db.one('SELECT 1 FROM plaza_rooms WHERE id=$1 AND state=\'planning\'',[secondId]),'다른 수업 범위 보존');
  check((await ok(admin.request('POST',maint+'/purge',purgeBody))).status==='verified','파기 응답 유실 후 같은 요청 재확인');
  for(const [table,rows] of Object.entries(snapshot))for(const row of rows){const keys=Object.keys(row).filter(k=>k!=='capture_order');await db.q(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>k==='current_photo_id'?null:row[k]));}
  for(const row of snapshot.plaza_participants)if(row.current_photo_id)await db.q('UPDATE plaza_participants SET current_photo_id=$1 WHERE id=$2',[row.current_photo_id,row.id]);
  await plant(retained.key,buffer);
  await db.q("UPDATE plaza_rooms SET state='planning',closed_at=NULL,photos_purged_at=NULL,activities_purged_at=NULL,audit_purged_at=NULL WHERE id=$1",[fixture.roomId]);
  await db.q("UPDATE class_sessions SET expires_at=now()+interval '12 hours' WHERE id=$1",[fixture.classSessionId]);await db.q('UPDATE decks SET published=true WHERE id=$1',[fixture.deckId]);
  check((await teacher.request('GET',room+'/teacher')).status===410,'종료 전 DB 복원에도 삭제 목록이 수업 조회 차단');
  const restoration=await ok(admin.request('GET',maint+'/preview?restore=1'));
  check(restoration.scopes.length===3,'복원 후 기한 재계산과 무관하게 삭제 범위 재적용');
  const reapplied=await ok(admin.request('POST',maint+'/purge',{attempt_id:uuid(),digest:restoration.digest,restore:true,confirm:true}));
  check(reapplied.status==='verified','복원 재적용 파일별 검증 완료');
  check(await count('plaza_participants')===0&&await count('plaza_drafts')===0&&await storage.absent(retained.key),'복원된 활동 원문·사진 파일 다시 삭제');
  check(JSON.stringify(await db.q('SELECT * FROM career_log.records ORDER BY id'))===originalRecords,'복원 재파기도 장기 기록 원본 불변');
  const otherMaint=`/api/plaza/rooms/${secondId}/retention`;await ok(admin.request('POST',otherMaint+'/policy',policy));
  const otherPid=uuid(),otherPhoto=uuid(),otherObject=uuid(),otherKey=`${otherObject}.jpg`;
  await db.q("INSERT INTO plaza_participants(id,room_id,student_uuid,seat_order,store_public_id,record_choice) VALUES($1,$2,NULL,1,$3,'no-record')",[otherPid,secondId,uuid()]);
  await db.q('INSERT INTO plaza_photos(id,room_id,participant_id,target_version,created_by) VALUES($1,$2,$3,1,$4)',[otherPhoto,secondId,otherPid,fixture.teacher.id]);
  await db.q('INSERT INTO plaza_photo_objects(id,photo_id,object_key) VALUES($1,$2,$3)',[otherObject,otherPhoto,otherKey]);await plant(otherKey,buffer);
  await db.q('INSERT INTO plaza_drafts(participant_id,content) VALUES($1,$2)',[otherPid,{plan:'가짜 보관 시간 시험'}]);
  const orphan=`${uuid()}.jpg`,orphanTemp=pgStore?`${uuid()}.jpg`:`${uuid()}.jpg.${uuid()}.tmp`,unrelated='unrelated-keep.txt';
  for(const key of [orphan,orphanTemp,unrelated])await plant(key,buffer);
  let inventory=await ok(admin.request('GET','/api/plaza/retention/orphans'));
  check(inventory.keys.length===2&&(pgStore?inventory.unrecognized_count===0:inventory.unrecognized_count>=1),'무작위 원본·임시 고아 파일만 목록에 포함');
  if(pgStore)await assert.rejects(db.q('INSERT INTO plaza_photo_blobs(object_key,data,digest,bytes) VALUES($1,$2,$3,$4)',[unrelated,buffer,digest(buffer),buffer.length]),/check constraint/),checks++;
  const extra=`${uuid()}.jpg`;await plant(extra,buffer);
  check((await admin.request('POST','/api/plaza/retention/orphans',{attempt_id:uuid(),digest:inventory.digest,confirm:true})).status===409,'고아 파일 목록 변경 시 재확인');
  inventory=await ok(admin.request('GET','/api/plaza/retention/orphans'));
  const orphanBody={attempt_id:uuid(),digest:inventory.digest,confirm:true};faults.remove='fail';
  check((await ok(admin.request('POST','/api/plaza/retention/orphans',orphanBody))).status==='retry','고아 파일 실패 상태 유지');
  faults.remove=null;check((await ok(admin.request('POST','/api/plaza/retention/orphans',orphanBody))).status==='verified','고아 파일 같은 목록 재시도 삭제');
  if(!pgStore)check(await present(unrelated),'다른 이름의 파일 보존');
  check(await present(otherKey),'고아 파일 파기는 다른 수업의 등록된 파일 보존');
  for(const [hours,scope] of [[1.5,'photos'],[2.5,'activities'],[3.5,'audit']]) {
    await db.q("UPDATE plaza_rooms SET state='closed',closed_at=now()-($1 * interval '1 hour') WHERE id=$2",[hours,secondId]);
    const next=await ok(admin.request('GET',otherMaint+'/preview'));check(next.scopes.join(',')===scope,scope+' 기한만 독립 도래');
    const result=await ok(admin.request('POST',otherMaint+'/purge',{attempt_id:uuid(),digest:next.digest,confirm:true}));check(result.status==='verified',scope+' 단독 파기 검증');
    if(scope==='photos')check(await storage.absent(otherKey)&&await count('plaza_drafts')===1,'사진 파기는 아직 기한 전 초안 보존');
    if(scope==='activities')check(await count('plaza_drafts')===0&&await count('plaza_participants')===1,'활동 파기는 아직 기한 전 운영 연결 보존');
    if(scope==='audit')check(await count('plaza_participants')===0,'운영 기한 도래 후 연결 파기');
  }
  check((await ok(admin.request('GET','/api/plaza/retention'))).gate.real_collection_allowed===false,'모든 시험 통과 후에도 실제 수집 차단');
  const managed=['plaza_retention_policies','plaza_purge_jobs','plaza_purge_items',...(pgStore?['plaza_store_marker','plaza_photo_blobs','plaza_purge_ledger']:[])];
  const rls=await db.q("SELECT relname,relrowsecurity FROM pg_class WHERE relname = ANY($1)",[managed]);
  check(rls.length===managed.length&&rls.every(r=>r.relrowsecurity),'새 관리 표 RLS 활성');
  if(pgStore)check(!(await db.one("SELECT has_table_privilege('anon','plaza_photo_blobs','SELECT') OR has_table_privilege('authenticated','plaza_photo_blobs','SELECT') AS allowed")).allowed,'공개 DB 사진 원본 조회 권한 없음');
  check(!(await db.one("SELECT has_table_privilege('anon','plaza_purge_jobs','SELECT') AS allowed")).allowed,'공개 DB 파기 이력 조회 권한 없음');
  console.log(`4단계 HTTP·DB·실파일 검증 ${checks}개 통과`);return {checks};
}
module.exports={verify,installFaults};
