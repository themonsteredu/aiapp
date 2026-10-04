'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {plazaConfig}=require('../lib/plaza-config');
const {client,ok,prepare,advance}=require('./plaza-rehearsal');
const uuid=()=>crypto.randomUUID();
// Faults are installed by this test process before loading server.js. No HTTP switch or runtime flag enables them.
function installFaults(){
  const faults={ai:'fail',photo:null,aiCalls:[],photoStarted:null,photoResume:null,aiStarted:null,aiResume:null};
  const mod=require('../lib/plaza-storage'),original=mod.localTestStorage;
  mod.localTestStorage=config=>{const store=original(config);return {...store,async put(key,image){
    if(faults.photo==='fail')throw new Error('simulated storage interruption');
    await store.put(key,image);
    if(faults.photo==='after-write')throw new Error('simulated acknowledgement loss');
    if(faults.photo==='pause'){faults.photoStarted?.();await new Promise(resolve=>{faults.photoResume=resolve;});}
  }};};
  const api=require('../lib/plaza-api'),register=api.registerPlazaRoutes;
  api.registerPlazaRoutes=deps=>register({...deps,aiProvider:async(input,{signal})=>{
    faults.aiCalls.push(structuredClone(input));const mode=faults.ai;
    if(mode==='fail')throw new Error('simulated provider outage');
    if(mode==='invalid')return {ideas:[{combination_id:'unapproved',introduction_id:'unapproved'}]};
    if(mode==='timeout')await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));
    if(mode==='pause'){faults.aiStarted?.();await new Promise(resolve=>{faults.aiResume=resolve;});}
    return require('../lib/plaza-program').exampleOutput(input);
  }});
  return faults;
}
async function verify({base='http://127.0.0.1:3999',fixture,faults}={}) {
  const config=plazaConfig();if(!config?.stage3||!faults)throw new Error('3단계 시험 서버와 시험 프로세스의 장애 어댑터가 필요합니다.');
  const db=require('../lib/db');fixture||=JSON.parse(await fs.readFile(path.join(config.storageRoot,'fixture.json'),'utf8'));
  assert.equal((await db.one('SELECT test_id FROM plaza_environment WHERE database_name=current_database()')).test_id,config.testId);
  let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
  const group=await prepare({base,fixture,count:5}),{teacher,people,room}=group;
  const info=()=>ok(teacher.request('GET',room+'/teacher'));
  const mine=p=>ok(p.client.request('GET',room+'/mine'));
  const row=async seat=>(await info()).participants.find(p=>p.seat_order===seat);
  async function phase(name,g=group){const t=await ok(g.teacher.request('GET',g.room+'/teacher'));return ok(g.teacher.request('POST',g.room+'/state',{state:name,version:t.room.version,participant_ids:t.participants.filter(p=>p.attendance!=='absent').map(p=>p.id),reason:'가짜 참여자 시험 종료'}));}
  async function login(){const j=client(base);await ok(j.request('POST','/api/join',{code:fixture.code,name:'리허설 기기 교체'}));return j;}
  async function issue(p){const r=await row(p.seat),body={participant_id:r.id,connection_version:r.connection_version,confirm:true,attempt_id:uuid()};return {body,result:await ok(teacher.request('POST',room+'/reissue',body))};}
  async function reconnect(p){const re=await issue(p),j=await login();await ok(j.request('POST',room+'/claim',{code:re.result.code,attempt_id:uuid()}));p.client=j;return re;}
  async function attendance(p,status){const r=await row(p.seat),body={participant_id:r.id,attendance:status,version:r.attendance_version,reason:'리허설 출석 변경',attempt_id:uuid()};const result=await ok(teacher.request('POST',room+'/attendance',body));check((await ok(teacher.request('POST',room+'/attendance',body))).duplicate,'출석 중복 요청은 한 번만');return result;}
  const first=people[0],identityBefore=await db.one('SELECT * FROM plaza_participants WHERE store_public_id=$1',[first.joined.participant.store_public_id]);
  check((await first.client.request('POST',room+'/reissue',{participant_id:identityBefore.id,attempt_id:uuid()})).status===403,'학생 재발급 권한 거절');
  check((await first.client.request('GET',room+'/paper')).status===403,'강사 종이 카드 권한');
  check(!!(await ok(teacher.request('GET',room+'/paper'))).card.requests.length,'강사 장애용 카드 준비');
  await assert.rejects(prepare({base,fixture,count:1}),/비어 있는/);checks++;
  // Retry entry even if both response body and Set-Cookie were lost.
  const extra=await login(),entryBody={mode:'new',seat_order:6,attempt_id:uuid()};
  const joined=await ok(extra.request('POST',room+'/enter',entryBody,{keepCookies:false}));
  const joinedAgain=await ok(extra.request('POST',room+'/enter',entryBody));
  check(joinedAgain.duplicate&&joinedAgain.participant.store_public_id===joined.participant.store_public_id,'입장 응답 유실 후 동일 참여자로 복구');
  check((await extra.request('POST',room+'/enter',{...entryBody,seat_order:7})).status===409,'입장 요청 번호 변조 거절');
  const sixth={seat:6,client:extra,joined};people.push(sixth);
  const ideas=await ok(extra.request('POST',room+'/ai',{kind:'ideas',attempt_id:uuid(),customer_id:'gentle',material_ids:['test-a','test-b']}));
  await ok(extra.request('PUT',room+'/draft',{...people[0].draft,attempt_id:uuid(),idea_id:ideas.output.ideas[0].id,artwork_name:'리허설 작품 6',store_name:'리허설 가게 6'}));
  const oldClient=first.client,re=await issue(first);
  check(re.result.code.replaceAll('-','').length===24&&new Date(re.result.expires_at)-Date.now()<=300000,'96비트 무작위 연결값과 5분 만료');
  check((await oldClient.request('GET',room+'/mine')).status===401,'재발급 즉시 이전 광장 로그인 차단');
  check((await oldClient.request('GET','/api/career-log/records')).status===401,'일반 진로기록 경로도 이전 로그인 차단');
  const reRetry=await ok(teacher.request('POST',room+'/reissue',re.body));check(reRetry.duplicate&&reRetry.code===null,'재발급 응답 재확인은 비밀값 복제와 이중 발급 없음');
  const attacker=await login();for(let i=0;i<5;i++)check((await attacker.request('POST',room+'/claim',{code:'wrong',attempt_id:uuid()})).status===400,'틀린 연결값의 일반 오류');
  check((await attacker.request('POST',room+'/claim',{code:re.result.code,attempt_id:uuid()})).status===429,'연결값 입력 횟수 제한');
  const newDevice=await login(),claim={code:re.result.code,attempt_id:uuid()};
  await ok(newDevice.request('POST',room+'/claim',claim,{keepCookies:false}));
  const restored=await ok(newDevice.request('POST',room+'/claim',claim));first.client=newDevice;
  check(restored.duplicate&&restored.participant.store_public_id===identityBefore.store_public_id&&restored.draft.content.store_name===first.draft.store_name,'교체 응답 유실 후 가게·구상 유지');
  const identityAfter=await db.one('SELECT * FROM plaza_participants WHERE id=$1',[identityBefore.id]);check(identityAfter.student_uuid===identityBefore.student_uuid,'기기를 바꿔도 진로 학생 UUID 유지');
  check((await db.one('SELECT count(*)::int AS n FROM plaza_device_grants WHERE participant_id=$1 AND revoked_at IS NULL',[identityBefore.id])).n===1,'활성 기기 권한 하나');
  const stranger=await login();check((await stranger.request('POST',room+'/claim',{...claim,attempt_id:uuid()})).status===400,'일회성 연결값 재사용 거절');
  const persisted=await db.q('SELECT code_hash FROM plaza_reissues');const operations=await db.q('SELECT result FROM plaza_operations');
  check(!JSON.stringify([...persisted,...operations]).includes(re.result.code.replaceAll('-','')),'DB에 원문 연결값 없음');
  const expired=await issue(people[1]);await db.q("UPDATE plaza_reissues SET expires_at=now()-interval '1 second' WHERE participant_id=$1 AND revoked_at IS NULL",[(await row(2)).id]);
  check((await stranger.request('POST',room+'/claim',{code:expired.result.code,attempt_id:uuid()})).status===400,'만료 연결값 거절');await reconnect(people[1]);
  // Old acknowledgements remain replayable after a newer successful write.
  const p2=people[1],original=p2.draft,next={...original,attempt_id:uuid(),version:1,store_name:'리허설 두 번째 간판'};
  await ok(p2.client.request('PUT',room+'/draft',next));const delayed=await ok(p2.client.request('PUT',room+'/draft',original));
  check(delayed.duplicate&&(await mine(p2)).draft.content.store_name===next.store_name,'나중에 온 이전 저장 재시도가 최신 간판을 덮어쓰지 않음');
  check((await p2.client.request('PUT',room+'/draft',{...original,store_name:'변조'})).status===409,'오래된 시도 번호도 내용 변조 거절');
  const bursts=await Promise.all(Array.from({length:8},()=>p2.client.request('PUT',room+'/draft',next)));check(bursts.every(r=>r.status===200&&r.data.duplicate),'8중 동시 저장 재시도 한 번');
  // Stored, failed and in-flight photos; stale target writes cannot reappear.
  const dataUrl=await fs.readFile(path.join(__dirname,'../test/fixtures/plaza-photo.txt'),'utf8');
  async function capture(p){const target=await row(p.seat),capture_id=uuid();await ok(teacher.request('POST',room+'/photos',{capture_id,participant_id:target.id,target_version:target.target_version}));return {id:capture_id,target};}
  const put=f=>teacher.request('PUT',room+'/photos/'+f.id,{data_url:dataUrl,target_version:f.target.target_version});
  const a=await capture(first);await ok(put(a));const bad=await capture(first);faults.photo='fail';check((await put(bad)).status===503,'저장소 실패는 미확인 응답');
  check((await row(1)).current_photo_id===a.id,'재촬영 실패 동안 이전 저장 사진 유지');
  faults.photo='after-write';check((await put(bad)).status===503,'파일 생성 뒤 응답 유실');faults.photo=null;
  const retryPhoto=await ok(put(bad));check(retryPhoto.saved&&(await row(1)).current_photo_id===bad.id,'같은 촬영으로 파일 확인 후 복구');
  const source=await row(1),destination=await row(2),move={capture_id:bad.id,participant_id:destination.id,source_version:source.target_version,target_version:destination.target_version,confirm:true,attempt_id:uuid()};
  const moved=await ok(teacher.request('POST',room+'/photo-move',move));check(moved.saved&&(await row(1)).current_photo_id===null&&(await row(2)).current_photo_id===moved.id,'사진 옮기기로 전시 대상만 변경');
  check((await teacher.request('GET',room+'/photos/'+bad.id)).status===404,'원래 가게의 사진 URL 즉시 차단');
  check((await ok(teacher.request('POST',room+'/photo-move',move))).id===moved.id,'사진 옮기기 응답 유실 재시도 한 번');
  check((await put(bad)).status===409,'옮기기 전 촬영 재전송 차단');
  check((await db.one('SELECT count(*)::int AS n FROM plaza_photo_objects WHERE photo_id=$1',[bad.id])).n===1,'옮기기 전 파일은 파기 단계 추적용으로 보존');
  const flying=await capture(first);faults.photo='pause';let started;const hasStarted=new Promise(r=>started=r);faults.photoStarted=started;
  const inFlight=put(flying);await hasStarted;const to=await row(3),from=await row(1);
  const redirectBody={capture_id:flying.id,participant_id:to.id,source_version:from.target_version,target_version:to.target_version,confirm:true,attempt_id:uuid()};
  const redirected=await ok(teacher.request('POST',room+'/photo-move',redirectBody));
  faults.photo=null;faults.photoResume();check((await inFlight).status===409,'옮기기와 겹친 이전 업로드 최종 확인 거절');
  check(redirected.needs_upload&&(await row(1)).current_photo_id===null,'전송 중 사진은 새 대상으로 전송 대기');
  await ok(teacher.request('PUT',room+'/photos/'+redirected.id,{data_url:dataUrl,target_version:redirected.target_version}));check((await row(3)).current_photo_id===redirected.id,'남은 사진 바이트를 명시한 새 대상으로 전송');
  check((await ok(teacher.request('POST',room+'/photo-move',redirectBody))).saved,'전송 대기 사진의 이동 응답을 잃어도 저장 완료 재확인');
  const newer=await capture(first),prior=await row(2),receiver=await row(3);
  await ok(teacher.request('POST',room+'/photo-move',{capture_id:newer.id,participant_id:prior.id,source_version:newer.target.target_version,target_version:prior.target_version,confirm:true,attempt_id:uuid()}));
  const kept=await row(2);check(kept.current_photo_id===moved.id&&kept.target_version>prior.target_version,'새 이동 사진 전송 전에는 목적지의 이전 저장 사진 유지');
  check((await ok(teacher.request('POST',room+'/photo-move',{capture_id:moved.id,participant_id:receiver.id,source_version:kept.target_version,target_version:receiver.target_version,confirm:true,attempt_id:uuid()}))).saved,'새 사진이 대기 중이어도 현재 전시 사진을 다시 옮길 수 있음');
  // Attendance before opening is excluded, without freeing the seat for another child.
  await attendance(sixth,'absent');check((await info()).counts.absent===1,'결석 별도 집계');
  const intruder=await login();check((await intruder.request('POST',room+'/enter',{mode:'new',seat_order:6,attempt_id:uuid()})).status===409,'결석 학생 자리 탈취 차단');
  await phase('paused');await phase('returning');await advance({...group,people:people.slice(0,5)});await phase('exchange');
  const before=await db.q('SELECT * FROM plaza_visits WHERE room_id=$1 AND retired_at IS NULL',[fixture.roomId]);check(before.length===5&&before.every(v=>v.visitor_id!==v.host_id),'개장 때 실제 참여 5명 순환');
  const departing=people[4],departingId=(await row(5)).id,affected=before.filter(v=>v.visitor_id===departingId||v.host_id===departingId);
  await attendance(departing,'absent');const after=await db.q('SELECT * FROM plaza_visits WHERE room_id=$1',[fixture.roomId]);
  check(affected.every(v=>after.find(a=>a.id===v.id).retired_at)&&before.filter(v=>!affected.includes(v)).every(v=>!after.find(a=>a.id===v.id).retired_at),'시작 전 영향받은 방문만 재배정');
  const oldVisit=affected.find(v=>v.host_id===departingId);
  const senderP=await db.one('SELECT seat_order FROM plaza_participants WHERE id=$1',[oldVisit.visitor_id]);
  check((await people.find(p=>p.seat===senderP.seat_order).client.request('POST',room+'/message',{kind:'request',visit_id:oldVisit.id,request_id:'gentle',attempt_id:uuid()})).status===409,'이전 배정으로 전송 대기하던 요청 거절');
  const firstView=await mine(first),requestBody={kind:'request',visit_id:firstView.exchange.outgoing.id,request_id:'gift',attempt_id:uuid(),medium:'paper-confirmed',confirm:true};
  await ok(first.client.request('POST',room+'/message',requestBody));
  const sent=await db.one('SELECT * FROM plaza_visits WHERE id=$1',[firstView.exchange.outgoing.id]);
  const hostSeat=(await db.one('SELECT seat_order FROM plaza_participants WHERE id=$1',[sent.host_id])).seat_order,host=people.find(p=>p.seat===hostSeat);
  await attendance(host,'absent');const preserved=await db.one('SELECT * FROM plaza_visits WHERE id=$1',[sent.id]);
  check(preserved.visitor_id===sent.visitor_id&&preserved.host_id===sent.host_id&&JSON.stringify(preserved.request)===JSON.stringify(sent.request)&&!preserved.retired_at,'요청 후 상대·원문 고정');
  check(preserved.fallback_reply.source==='example'&&preserved.fallback_reply.reason,'결석 상대 답장은 출처·사유가 있는 예시로 대체');
  check((await ok(first.client.request('POST',room+'/message',requestBody))).duplicate,'결석 처리 후에도 기존 학생 요청 재시도 유지');
  for(const p of people){if((await row(p.seat)).attendance==='absent'){await attendance(p,'present');await reconnect(p);}}
  const returned=await db.one('SELECT * FROM plaza_visits WHERE id=$1',[sent.id]);check(returned.visitor_id===sent.visitor_id&&returned.host_id===sent.host_id&&JSON.stringify(returned.request)===JSON.stringify(sent.request),'늦은 복귀에도 확정 배정 보존');
  await advance(group);await phase('reflection');await advance(group);
  const receipt=(await mine(first)).receipt;check(receipt.saved&&receipt.snapshot.plaza.exchange.mode==='example-substitution'&&receipt.snapshot.plaza.exchange.media.request==='paper-confirmed','대체·종이 확인 출처를 최종 기록에 구분');
  check(!JSON.stringify(receipt.snapshot).includes('리허설 출석 변경'),'강사가 적은 상세 결석 사유를 다른 학생 기록에 복제하지 않음');
  check(receipt.snapshot.process.includes('본인이 확인'),'종이 활동 확인 주체를 기록');
  const record=await db.one('SELECT * FROM career_log.records WHERE id=$1',[receipt.record_id]);check(record.student_id===identityBefore.student_uuid&&record.program_ref===`job-deck:${fixture.deckId}`&&record.session_ref===`job-class:${fixture.classSessionId}`,'교체 후에도 실제 학생·자료·수업 기록 연결');
  const finals=await Promise.all(Array.from({length:8},()=>first.client.request('POST',room+'/record',{attempt_id:receipt.attempt_id,digest:receipt.digest})));check(finals.every(r=>r.status===200&&r.data.duplicate),'최종 기록 8중 제출 한 건');
  await attendance(first,'absent');await attendance(first,'present');await reconnect(first);
  check(JSON.stringify((await mine(first)).receipt.snapshot)===JSON.stringify(receipt.snapshot),'기록 확정 뒤 출석 변경에도 원문 불변');
  const oldRecordCount=(await db.one('SELECT count(*)::int AS n FROM career_log.records')).n;check(oldRecordCount===6,'여섯 가짜 참여자 각각 한 기록');
  await phase('closed');check((await first.client.request('POST',room+'/record',{attempt_id:receipt.attempt_id,digest:receipt.digest})).status===401,'종료 후 늦은 재전송 차단');
  check((await db.one('SELECT count(*)::int AS n FROM career_log.records')).n===oldRecordCount,'종료 뒤 새 기록 없음');
  const oldGuest=await db.one('SELECT login_user_id FROM plaza_device_grants WHERE participant_id=$1 ORDER BY version DESC LIMIT 1',[identityBefore.id]);
  await db.q('DELETE FROM users WHERE id=$1',[oldGuest.login_user_id]);
  check(!!await db.one('SELECT 1 FROM career_log.records WHERE id=$1',[receipt.record_id]),'기존 만료 게스트 정리는 막지 않고 진로기록은 보존');
  // New isolated rooms exercise AI faults and 30 independent cookie jars at the HTTP boundary.
  async function fixtureRoom(title){const cs=await db.one('INSERT INTO class_sessions(code,title,created_by,instructor_id,expires_at) VALUES($1,$2,$3,$3,now()+interval \'2 hours\') RETURNING id,code',[String(crypto.randomInt(100000,1000000)),title,fixture.teacher.id]);
    await db.q('INSERT INTO session_items(session_id,deck_id) VALUES($1,$2)',[cs.id,fixture.deckId]);const roomId=uuid();await db.q('INSERT INTO plaza_rooms(id,class_session_id,deck_id,program_version_id,seat_count) SELECT $1,$2,deck_id,program_version_id,30 FROM plaza_rooms WHERE id=$3',[roomId,cs.id,fixture.roomId]);return {...fixture,roomId,classSessionId:cs.id,code:cs.code};}
  {
    const f=await fixtureRoom('AI 응답 중 기기 교체'),r=`/api/plaza/rooms/${f.roomId}`,j=client(base);
    await ok(j.request('POST','/api/join',{code:f.code,name:'가짜 지연 응답'}));await ok(j.request('POST',r+'/enter',{mode:'new',seat_order:1,attempt_id:uuid()}));
    const p=(await ok(teacher.request('GET',r+'/teacher'))).participants[0];
    let started;const hasStarted=new Promise(resolve=>started=resolve);faults.ai='pause';faults.aiStarted=started;
    const body={kind:'ideas',attempt_id:uuid(),customer_id:'gentle',material_ids:['test-a','test-b']};
    const pending=j.request('POST',r+'/ai',body);await hasStarted;
    const issued=await ok(teacher.request('POST',r+'/reissue',{participant_id:p.id,connection_version:p.connection_version,confirm:true,attempt_id:uuid()}));
    faults.aiResume();check((await pending).status===401,'AI 실행 중 재발급하면 이전 요청의 최종 저장 차단');
    const fresh=client(base);await ok(fresh.request('POST','/api/join',{code:f.code,name:'가짜 새 기기'}));await ok(fresh.request('POST',r+'/claim',{code:issued.code,attempt_id:uuid()}));
    check((await ok(fresh.request('POST',r+'/ai',body))).status==='running','중단 호출은 즉시 다시 외부 호출하지 않음');
    await db.q("UPDATE plaza_ai_runs SET created_at=now()-interval '21 seconds' WHERE participant_id=$1",[p.id]);
    const calls=faults.aiCalls.length,recovered=await ok(fresh.request('POST',r+'/ai',body));check(recovered.source==='example'&&recovered.failure_code==='interrupted'&&recovered.call_attempted&&faults.aiCalls.length===calls,'실행 중단은 예시 복구하고 호출·실제 사용 출처 분리');
    const capture=uuid();await ok(teacher.request('POST',r+'/photos',{capture_id:capture,participant_id:p.id,target_version:p.target_version}));
    check((await teacher.request('POST',r+'/photo-move',{capture_id:capture,participant_id:identityBefore.id,source_version:1,target_version:1,confirm:true,attempt_id:uuid()})).status===404,'다른 반 참여자로 사진 옮기기 차단');
    await db.q('UPDATE session_items SET unlocked=false WHERE session_id=$1 AND deck_id=$2',[f.classSessionId,f.deckId]);
    check((await teacher.request('POST',r+'/reissue',{participant_id:p.id,connection_version:1,confirm:true,attempt_id:uuid()})).status===403,'자료 잠금이 재발급에도 적용');
    check((await fresh.request('POST',r+'/claim',{code:issued.code,attempt_id:uuid()})).status===403,'자료 잠금이 기기 연결에도 적용');
    await db.q('UPDATE session_items SET unlocked=true WHERE session_id=$1 AND deck_id=$2',[f.classSessionId,f.deckId]);
    await db.q("UPDATE class_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[f.classSessionId]);
    check((await teacher.request('POST',r+'/attendance',{participant_id:p.id,attendance:'absent',version:0,reason:'시험',attempt_id:uuid()})).status===403,'만료 수업 출석 변경 차단');
    check((await fresh.request('GET',r+'/mine')).status===401,'만료 수업 새 기기 로그인 폐기 및 조회 차단');
  }
  for(const mode of ['invalid','timeout','ok']){
    faults.ai=mode;const f=await fixtureRoom('가짜 AI 장애 '+mode),j=client(base),r=`/api/plaza/rooms/${f.roomId}`;await ok(j.request('POST','/api/join',{code:f.code,name:'가짜 AI 시험'}));await ok(j.request('POST',r+'/enter',{mode:'new',seat_order:1,attempt_id:uuid()}));
    const body={kind:'ideas',customer_id:'gentle',material_ids:['test-a','test-b'],attempt_id:uuid()},calls=faults.aiCalls.length;
    const responses=await Promise.all(Array.from({length:4},()=>j.request('POST',r+'/ai',body)));check(responses.every(r=>r.status===200),'AI 중복 요청 응답');
    const final=await ok(j.request('POST',r+'/ai',body));check(faults.aiCalls.length===calls+1&&final.call_attempted&&final.source===(mode==='ok'?'ai':'example'),'AI '+mode+' 호출 한 번과 실제 사용 출처');
    if(mode==='timeout')check(final.failure_code==='timeout','제한 시간 뒤 호출 취소 및 예시');
  }
  faults.ai='fail';const large=await prepare({base,fixture:await fixtureRoom('30명 가짜 리허설'),count:30});
  const polling=await Promise.all(large.people.map(p=>p.client.request('GET',large.room+'/mine')));check(polling.every(r=>r.status===200)&&new Set(polling.map(r=>r.data.participant.store_public_id)).size===30,'30개 독립 접속의 동시 조회와 가게 분리');
  await phase('paused',large);await phase('returning',large);await advance(large);await phase('exchange',large);await advance(large);await phase('reflection',large);await advance(large);
  const finished=await ok(large.teacher.request('GET',large.room+'/teacher'));check(finished.counts.record_saved===30&&finished.counts.peer_complete===30&&finished.counts.record_missing===0,'30명 전체 흐름 각각 또래 교류·기록 완료');
  const solo=await prepare({base,fixture:await fixtureRoom('1명 가짜 리허설'),count:1});await phase('paused',solo);await phase('returning',solo);await advance(solo);await phase('exchange',solo);await advance(solo);await phase('reflection',solo);await advance(solo);
  const soloDone=await ok(solo.teacher.request('GET',solo.room+'/teacher'));check(soloDone.counts.peer_complete===0&&soloDone.counts.substitute_complete===1&&soloDone.counts.record_saved===1,'1인 대체 진행 양방향을 분리해 기록');
  check(faults.aiCalls.every(input=>!JSON.stringify(input).includes('student_uuid')&&!JSON.stringify(input).includes('리허설 가게')&&!JSON.stringify(input).includes('data:image')),'외부 어댑터에 학생·가게·사진·자유 서술 없음');
  const tables=['plaza_operations','plaza_write_receipts','plaza_reissues','plaza_claim_limits'];for(const name of tables){const t=await db.one('SELECT relrowsecurity FROM pg_class WHERE relname=$1',[name]);check(t.relrowsecurity&&!(await db.one("SELECT has_table_privilege('anon',$1,'SELECT') AS allowed",[name])).allowed,'새 표 RLS·익명 조회 차단 '+name);}
  const records=(await db.one('SELECT count(*)::int AS n FROM career_log.records')).n;
  const result={stage:3,status:'passed',checks,records,concurrentClients:30,externalAiCalls:0,adapterCalls:faults.aiCalls.length};console.log(JSON.stringify(result));return result;
}
module.exports={installFaults,verify};
if(require.main===module){const faults=installFaults();require('../server');verify({faults}).then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1);});}
