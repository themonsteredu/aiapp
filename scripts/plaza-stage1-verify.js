'use strict';
// HTTP + SQL integration checks against the explicitly marked disposable test database.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {plazaConfig}=require('../lib/plaza-config');
async function verify({base='http://127.0.0.1:3999',fixture,finalize=true}={}) {
  const config=plazaConfig(); if(!config) throw new Error('시험 환경만 검증할 수 있습니다.');
  fixture ||= JSON.parse(await fs.readFile(path.join(config.storageRoot,'fixture.json'),'utf8'));
  const db=require('../lib/db');
  const marker=await db.one('SELECT test_id FROM plaza_environment WHERE database_name=current_database()');assert.equal(marker.test_id,config.testId);
  let checks=0;
  const check=(condition,message)=>{assert.ok(condition,message);checks++;};
  function jar() {
    const cookies=new Map();
    return {cookies,async request(method,url,body,origin=base){
      const res=await fetch(base+url,{method,headers:{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
      for(const line of res.headers.getSetCookie()){const [pair]=line.split(';');const at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));}
      const data=res.headers.get('content-type')?.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer());
      return {status:res.status,data,headers:res.headers};
    }};
  }
  const r=`/api/plaza/rooms/${fixture.roomId}`;
  const teacher=jar(),a=jar(),b=jar(),outsider=jar();
  check((await teacher.request('POST','/api/login',fixture.teacher)).status===200,'강사 로그인');
  check((await a.request('POST','/api/join',{code:fixture.code,name:'시험 학생 A'})).status===200,'코드 입장 A');
  check((await b.request('POST','/api/join',{code:fixture.code,name:'시험 학생 B'})).status===200,'코드 입장 B');
  const link=await a.request('GET',`/api/decks/${fixture.deckId}`);check(link.data.plaza.id===fixture.roomId,'실제 자료 연결로 자체 광장 분기');
  check((await outsider.request('GET',r+'/entry')).status===401,'미로그인 차단');
  check((await a.request('POST',r+'/enter',{mode:'new',seat_order:1},'https://unrelated.example')).status===403,'교차 출처 쓰기 차단');
  let enter=await a.request('POST',r+'/enter',{mode:'new',seat_order:1});check(enter.status===200,'새 참여자 생성');
  const store=enter.data.participant.store_public_id;
  check(!JSON.stringify(enter.data).includes('student_uuid')&&!JSON.stringify(enter.data).includes('secret_hash'),'학생 번호·비밀값 미노출');
  check((await b.request('POST',r+'/enter',{mode:'new',seat_order:1})).status===409,'자리 충돌 차단');
  const bEnter=await b.request('POST',r+'/enter',{mode:'new',seat_order:2});check(bEnter.status===200,'다른 자리 연결');
  const draft={attempt_id:crypto.randomUUID(),version:0,customer_id:'gentle',plan:'향이 부담스럽지 않게 소개할 방법을 생각했어요.',artwork_name:'바람 조각',store_name:'작은 향 공방'};
  const saved=await a.request('PUT',r+'/draft',draft);check(saved.status===200&&saved.data.saved,'구상 서버 저장');
  const duplicate=await a.request('PUT',r+'/draft',draft);check(duplicate.data.duplicate&&duplicate.data.version===1,'같은 저장 재시도는 한 번');
  check((await a.request('PUT',r+'/draft',{...draft,plan:'다른 내용'})).status===409,'같은 시도 다른 내용 충돌');
  check((await a.request('PUT',r+'/draft',{...draft,attempt_id:crypto.randomUUID()})).status===409,'오래된 버전 덮어쓰기 차단');
  check(Object.keys((await b.request('GET',r+'/mine')).data.draft.content).length===0,'다른 학생 초안 분리');
  let info=(await teacher.request('GET',r+'/teacher')).data;
  check(info.incomplete===1&&info.participants.length===2,'학생별 실제 미완료 수');
  check(!JSON.stringify(info).includes(draft.plan)&&!JSON.stringify(info).includes('student_uuid'),'강사용 목록에도 개인 구상 원문·학생 번호 제외');
  check((await teacher.request('POST',r+'/state',{state:'paused',version:info.room.version})).status===200,'제작 잠시 멈춤');
  check((await a.request('PUT',r+'/draft',{...draft,version:1,attempt_id:crypto.randomUUID()})).status===409,'잠시 멈춤은 구상 쓰기 차단');
  const oldSession=a.cookies.get('session');
  check((await a.request('POST','/api/join',{code:fixture.code,name:'시험 학생 A 재입장'})).status===200,'코드 재입장');
  check((await a.request('GET',r+'/mine')).status===403,'쿠키만으로 개인 구상 자동 열람 차단');
  const resumed=await a.request('POST',r+'/enter',{mode:'resume'});
  check(resumed.status===200&&resumed.data.participant.store_public_id===store&&resumed.data.draft.content.store_name===draft.store_name,'명시적 재입장 같은 가게·구상');
  const revoked=jar();revoked.cookies.set('session',oldSession);
  check((await revoked.request('GET','/api/career-log/records')).status===401,'이전 로그인 일반 진로기록 접근 폐기');
  check((await a.request('POST','/api/career-log/records',{deck_id:fixture.deckId,attempt_id:crypto.randomUUID(),process:'임의 저장',reflection:'아직 돌아보기 전'})).status===409,'광장 중간 구상의 일반 기록 우회 저장 차단');
  info=(await teacher.request('GET',r+'/teacher')).data;
  const target=info.participants.find(p=>p.store_public_id===store),captureId=crypto.randomUUID();
  const capture={capture_id:captureId,participant_id:target.id,target_version:target.target_version};
  check((await teacher.request('POST',r+'/photos',capture)).status===200,'촬영 대상 예약');
  check((await teacher.request('POST',r+'/photos',{...capture,participant_id:info.participants.find(p=>p.id!==target.id).id})).status===409,'같은 촬영 번호 대상 바꾸기 차단');
  const photo=await fs.readFile(path.join(__dirname,'../test/fixtures/plaza-photo.txt'),'utf8');
  check((await a.request('PUT',r+'/photos/'+captureId,{data_url:photo})).status===403,'학생 촬영 업로드 차단');
  const uploaded=await teacher.request('PUT',r+'/photos/'+captureId,{data_url:photo});check(uploaded.status===200&&uploaded.data.saved,'사진 파일·DB 연결 확인');
  const photoRetry=await teacher.request('PUT',r+'/photos/'+captureId,{data_url:photo});check(photoRetry.data.duplicate,'사진 전송 재시도 중복 없음');
  const photoUrl=r+'/photos/'+captureId;
  const aPhoto=await a.request('GET',photoUrl);check(aPhoto.status===200&&aPhoto.headers.get('cache-control')==='private, no-store','자기 작품만 인증 서버로 조회');
  check((await b.request('GET',photoUrl)).status===404,'다른 학생 사진 번호 직접 접근 차단');
  check((await outsider.request('GET',photoUrl)).status===401,'미로그인 사진 차단');
  check((await db.one('SELECT count(*)::int AS n FROM career_log.records')).n===0,'중간 활동 진로기록 0건');
  // Existing material permissions stay effective while the room is paused.
  await db.q('UPDATE session_items SET unlocked=false WHERE session_id=$1 AND deck_id=$2',[fixture.classSessionId,fixture.deckId]);
  check((await a.request('GET',r+'/mine')).status===403,'기존 자료 잠금 존중');
  check((await a.request('GET',photoUrl)).status===403,'사진도 기존 자료 잠금 존중');
  await db.q('UPDATE session_items SET unlocked=true WHERE session_id=$1 AND deck_id=$2',[fixture.classSessionId,fixture.deckId]);
  info=(await teacher.request('GET',r+'/teacher')).data;
  check((await teacher.request('POST',r+'/state',{state:'planning',version:info.room.version})).status===200,'잠시 멈춤 뒤 수업 재개');
  const restarted=await a.request('POST',r+'/enter',{mode:'new',seat_order:1,replace_current:true});
  check(restarted.status===200&&restarted.data.participant.store_public_id!==store&&Object.keys(restarted.data.draft.content).length===0,'같은 기기 다음 학생은 새 참여자');
  check((await a.request('GET',photoUrl)).status===404,'다음 학생에게 이전 사진 차단');
  // Unrelated instructor and partner are rejected by the actual dispatcher/service.
  const {hashPassword}=require('../lib/password');
  for(const role of ['instructor','partner']){
    const password=crypto.randomBytes(18).toString('hex'),username='test-'+role+'-'+crypto.randomBytes(3).toString('hex');
    await db.q('INSERT INTO users(username,password_hash,name,role,agreed_version) VALUES($1,$2,$3,$4,1)',[username,hashPassword(password),'시험 계정',role]);
    const denied=jar();check((await denied.request('POST','/api/login',{username,password})).status===200,role+' 시험 로그인');
    check((await denied.request('GET',r+'/teacher')).status===403,role+' 비담당 광장 차단');
    check((await denied.request('POST',r+'/photos',capture)).status===403,role+' 비담당 촬영 차단');
  }
  await db.q('UPDATE session_items SET student_visible=false WHERE session_id=$1 AND deck_id=$2',[fixture.classSessionId,fixture.deckId]);
  check((await b.request('GET',r+'/entry')).status===403,'기존 자료 비공개 존중');
  await db.q('UPDATE session_items SET student_visible=true WHERE session_id=$1 AND deck_id=$2',[fixture.classSessionId,fixture.deckId]);
  check((await teacher.request('PUT',r+'/photos/'+captureId,{data_url:'data:image/jpeg;base64,AAAA'})).status===400,'가짜 JPG 업로드 거절');
  // RLS and privileges on all new tables.
  const policies=await db.q("SELECT relname,relrowsecurity FROM pg_class WHERE relname LIKE 'plaza_%' AND relkind='r'");
  check(policies.length===9&&policies.every(p=>p.relrowsecurity),'신규 9개 표 RLS 적용');
  const grants=await db.one("SELECT bool_and(NOT has_table_privilege('anon',oid,'SELECT') AND NOT has_table_privilege('authenticated',oid,'SELECT')) AS blocked FROM pg_class WHERE relname LIKE 'plaza_%' AND relkind='r'");
  check(grants.blocked,'공개 역할 직접 조회 권한 없음');
  if(finalize){
    info=(await teacher.request('GET',r+'/teacher')).data;
    check((await teacher.request('POST',r+'/state',{state:'closed',version:info.room.version})).status===200,'광장 최종 종료');
    check((await b.request('GET',r+'/mine')).status===401,'종료 후 광장 접근 폐기');
    check((await b.request('GET','/api/career-log/records')).status===401,'종료 후 일반 진로기록 접근 폐기');
    check((await a.request('GET',photoUrl)).status===401,'종료 후 사진 접근 폐기');
    check((await teacher.request('POST',r+'/state',{state:'planning',version:info.room.version+1})).status===409,'종료된 광장 재개 거절');
    check((await db.one('SELECT count(*)::int AS n FROM career_log.records')).n===0,'종료도 미완료 진로기록 생성하지 않음');
  }
  console.log(JSON.stringify({integration_checks:checks,status:'passed',roomId:fixture.roomId}));
  return {checks,fixture,teacher,a,b,base};
}
module.exports={verify};
if(require.main===module)verify().then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1)});
