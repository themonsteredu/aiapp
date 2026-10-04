'use strict';
// Real HTTP dispatcher + PostgreSQL queries, exclusively against disposable marked local fixtures.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {plazaConfig}=require('../lib/plaza-config');
async function verify({base='http://127.0.0.1:3999',fixture}={}) {
  const config=plazaConfig();if(!config?.stage2)throw new Error('2단계 별도 시험 환경만 검증합니다.');
  const db=require('../lib/db');fixture||=JSON.parse(await fs.readFile(path.join(config.storageRoot,'fixture.json'),'utf8'));
  assert.equal((await db.one('SELECT test_id FROM plaza_environment WHERE database_name=current_database()')).test_id,config.testId);
  let checks=0;const check=(condition,label)=>{assert.ok(condition,label);checks++;};
  function jar(){const cookies=new Map();return {cookies,async request(method,url,body,origin=base){
    const res=await fetch(base+url,{method,headers:{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    for(const line of res.headers.getSetCookie()){const pair=line.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return {status:res.status,data:res.headers.get('content-type')?.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer()),headers:res.headers};
  }};}
  async function ok(promise,label){const r=await promise;check(r.status===200,`${label}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
  const teacher=jar(),outsider=jar();await ok(teacher.request('POST','/api/login',fixture.teacher),'강사 로그인');
  const r=`/api/plaza/rooms/${fixture.roomId}`;
  const students=[jar(),jar(),jar()];
  const mine=(j,room=r)=>ok(j.request('GET',room+'/mine'),'내 활동');
  const info=(room=r)=>ok(teacher.request('GET',room+'/teacher'),'강사 현황');
  async function change(next,room=r,extra={}){const t=await info(room);return ok(teacher.request('POST',room+'/state',{state:next,version:t.room.version,participant_ids:t.participants.map(p=>p.id),...extra}),'단계 '+next);}
  const auth=[];
  for(let i=0;i<students.length;i++){
    await ok(students[i].request('POST','/api/join',{code:fixture.code,name:`시험 학생 ${i+1}`}),`코드 학생 ${i+1}`);
    auth.push(await ok(students[i].request('POST',r+'/enter',{mode:'new',seat_order:i+1}),'새 참여'));
  }
  check((await students[0].request('GET',r+'/slides')).status===403,'학생 교안 직접 조회 차단');
  check((await outsider.request('GET',r+'/slides')).status===401,'미로그인 교안 차단');
  const material=(await ok(teacher.request('GET',r+'/slides'),'담당 강사 교안')).material;
  check(!!material?.slides.length,'별도 비공개 교안 조회');
  check((await students[0].request('PUT',r+'/slides',{title:'위조',slides:[]})).status===403,'학생 교안 등록 차단');
  check((await students[0].request('POST',r+'/ai',{kind:'ideas',attempt_id:crypto.randomUUID(),customer_id:'gentle',material_ids:['invented']})).status===400,'미승인 재료 차단');
  async function plan(j,i,room=r){
    const payload={kind:'ideas',attempt_id:crypto.randomUUID(),customer_id:'gentle',material_ids:['test-a','test-b'],student_uuid:'forged',store_name:'PRIVATE_NOT_FOR_AI'};
    const ideas=await ok(j.request('POST',room+'/ai',payload),'구상 2개');
    check(ideas.source==='example'&&!ideas.call_attempted&&ideas.output.ideas.length===2,'연결 전 예시와 미호출 출처');
    check((await ok(j.request('POST',room+'/ai',payload),'구상 재시도')).output.ideas.length===2,'반복 제안 조회');
    check((await j.request('POST',room+'/ai',{...payload,attempt_id:crypto.randomUUID(),customer_id:'gift'})).status===409,'AI 재호출로 선택 바꾸기 차단');
    const idea=ideas.output.ideas[0];
    const draft={attempt_id:crypto.randomUUID(),version:0,idea_id:idea.id,combination_id:idea.combination_id,introduction_id:idea.introduction_id,
      artwork_seed_id:'piece',artwork_name:`시험 작품 ${i}`,store_seed_id:'workshop',store_name:`시험 가게 ${i}`};
    check((await j.request('PUT',room+'/draft',draft)).status===400,'바꾸지 않은 구상 거절');
    draft.introduction_id='guide';
    check((await j.request('PUT',room+'/draft',{...draft,store_name:'작은 공방'})).status===400,'이름 후보 그대로 완료 차단');
    await ok(j.request('PUT',room+'/draft',draft),'학생 수정·간판 저장');
    check((await ok(j.request('PUT',room+'/draft',draft),'간판 재시도')).duplicate,'간판 중복 없음');
    check((await j.request('PUT',room+'/draft',{...draft,store_name:'변조'})).status===409,'같은 시도 다른 간판 충돌');
  }
  for(let i=0;i<3;i++)await plan(students[i],i);
  const runs=await db.q('SELECT input FROM plaza_ai_runs');check(runs.length===3&&!JSON.stringify(runs).includes('PRIVATE_NOT_FOR_AI')&&!JSON.stringify(runs).includes('forged'),'AI 로그에도 외부 허용 입력만 저장');
  const board=await ok(students[0].request('GET',r+'/board'),'광장 간판');
  check(board.stores.length===3&&board.stores.every(s=>Object.keys(s).sort().join()===['id','name','artwork_name','introduction','photo_url'].sort().join()),'공개 전시 응답 최소 필드');
  check((await ok(students[0].request('GET',r+`/board?since=${board.version}`),'변경 조회')).unchanged,'변경 없음 응답');
  check((await db.one('SELECT count(*)::int AS n FROM career_log.records')).n===0,'구상은 장기 기록 0건');
  check((await students[0].request('POST','/api/career-log/records',{deck_id:fixture.deckId,attempt_id:crypto.randomUUID(),process:'위조',reflection:'위조'})).status===409,'일반 기록 우회 차단 유지');
  check((await students[0].request('POST',r+'/record-preview',{})).status===409,'성찰 이전 기록 확정 차단');
  await change('paused');
  const oldStore=auth[0].participant.store_public_id;
  await ok(students[0].request('POST','/api/join',{code:fixture.code,name:'재입장 시험'}),'제작 뒤 코드 재입장');
  check((await students[0].request('GET',r+'/mine')).status===403,'명시적 이어가기 전 내용 차단');
  check((await ok(students[0].request('POST',r+'/enter',{mode:'resume'}),'같은 자리 이어가기')).participant.store_public_id===oldStore,'제작 전후 가게 연결 유지');
  const t=await info(),capture=crypto.randomUUID();
  await ok(teacher.request('POST',r+'/photos',{capture_id:capture,participant_id:t.participants[0].id,target_version:t.participants[0].target_version}),'작품 촬영 예약');
  await ok(teacher.request('PUT',r+'/photos/'+capture,{data_url:await fs.readFile(path.join(__dirname,'../test/fixtures/plaza-photo.txt'),'utf8')}),'작품 사진 저장');
  check((await students[1].request('GET',r+'/photos/'+capture)).status===404,'개장 전 다른 작품 사진 차단');
  await change('returning');
  for(const j of students){const m=await mine(j);await ok(j.request('PUT',r+'/activity',{kind:'actual',attempt_id:crypto.randomUUID(),version:m.activity.version,result:'changed',note:'소개를 더 짧게 바꿨어요.'}),'실제 제작 결과');}
  const before=await info();check((await teacher.request('POST',r+'/state',{state:'exchange',version:before.room.version,participant_ids:[]})).status===409,'명단 확인 없이 배정 차단');
  await change('exchange');
  check((await students[1].request('GET',r+'/photos/'+capture)).status===200,'개장 후 같은 반 전시 사진 인증 조회');
  const visits=await db.q('SELECT * FROM plaza_visits WHERE room_id=$1',[fixture.roomId]);
  check(visits.length===3&&visits.every(v=>v.visitor_id!==v.host_id)&&new Set(visits.map(v=>v.host_id)).size===3,'홀수 3명 일대일 순환 배정');
  for(const j of students){const m=await mine(j);check(!!m.exchange.outgoing&&!!m.exchange.incoming,'각 학생 방문·손님 하나');
    const body={kind:'request',attempt_id:crypto.randomUUID(),request_id:'gentle'};await ok(j.request('POST',r+'/message',body),'요청 보내기');check((await ok(j.request('POST',r+'/message',body),'요청 재전송')).duplicate,'요청 중복 방지');
    check((await j.request('POST',r+'/message',{...body,request_id:'gift'})).status===409,'보낸 요청 변조 거절');}
  check(JSON.stringify((await db.q('SELECT id,visitor_id,host_id FROM plaza_visits WHERE room_id=$1 ORDER BY id',[fixture.roomId])))===JSON.stringify(visits.map(v=>({id:v.id,visitor_id:v.visitor_id,host_id:v.host_id})).sort((a,b)=>a.id.localeCompare(b.id))),'요청 후 배정 고정');
  for(const [i,j] of students.entries()){
    const run=await ok(j.request('POST',r+'/ai',{kind:'reply',attempt_id:crypto.randomUUID()}),'답장 초안');
    const m=await mine(j),original=m.card.reply_options.find(r=>r.id===run.output.reply_id).text;
    const body={kind:'reply',attempt_id:crypto.randomUUID(),text:original};
    check((await j.request('POST',r+'/message',body)).status===400,'답장 초안 무수정 제출 거절');
    body.text=`손님의 궁금한 점부터 들을게요. 키트 안내를 함께 확인해요. 내 답장 ${i}`;
    await ok(j.request('POST',r+'/message',body),'학생 수정 답장');check((await ok(j.request('POST',r+'/message',body),'답장 재전송')).duplicate,'답장 한 번만');
  }
  for(const j of students)await ok(j.request('POST',r+'/message',{kind:'reaction',attempt_id:crypto.randomUUID(),reaction_id:'understood'}),'답장 반응');
  await change('reflection');
  for(const [i,j] of students.entries()){
    check((await j.request('POST',r+'/record-preview',{})).status===409,'빈 성찰로 최종 기록 불가');
    const m=await mine(j);await ok(j.request('PUT',r+'/activity',{kind:'reflection',version:m.activity.version,attempt_id:crypto.randomUUID(),answers:[`내 성찰 비공개 ${i}`,'다시 읽어 봤어요.','향을 설명하는 방법']}),'돌아보기 저장');
  }
  const teacherView=await info();check(!JSON.stringify(teacherView).includes('내 성찰 비공개'),'강사 현황에 성찰 원문 없음');
  const afterBoard=await ok(students[0].request('GET',r+'/board'),'교류 뒤 광장');check(!JSON.stringify(afterBoard).includes('성찰')&&!JSON.stringify(afterBoard).includes('student_uuid'),'전시에 개인 활동·학생 연결 없음');
  const preview=await ok(students[0].request('POST',r+'/record-preview',{}),'최종 내용 고정');
  check(!preview.saved&&preview.snapshot.process.includes('준비된 예시')&&!preview.snapshot.process.includes('AI 제안'),'기록 내용에 실제 출처 표시');
  check(!JSON.stringify(preview.snapshot).includes('내 성찰 비공개 1')&&!JSON.stringify(preview.snapshot).includes('내 답장 1'),'타인 원문 기록 복제 없음');
  check((await ok(students[0].request('POST',r+'/record-preview',{}),'고정 내용 다시 조회')).attempt_id===preview.attempt_id,'최종 저장 번호 서버 유지');
  const m0=await mine(students[0]);check((await students[0].request('PUT',r+'/activity',{kind:'reflection',attempt_id:crypto.randomUUID(),version:m0.activity.version,answers:['변경','변경','변경']})).status===409,'확정 뒤 활동 변경 차단');
  check((await students[0].request('POST',r+'/record',{attempt_id:preview.attempt_id,digest:'changed'})).status===409,'고정 원문 해시 변조 차단');
  const finalBody={attempt_id:preview.attempt_id,digest:preview.digest,student_uuid:auth[1].participant.store_public_id,process:'forged'};
  const saved=await ok(students[0].request('POST',r+'/record',finalBody),'진로기록 저장');
  check(saved.saved&&saved.record_id,'서버 확인 접수');
  const retried=await ok(students[0].request('POST',r+'/record',finalBody),'응답 유실 재시도');check(retried.duplicate&&retried.record_id===saved.record_id,'한 참여자 최종 기록 하나');
  const record=await db.one('SELECT * FROM career_log.records WHERE id=$1',[saved.record_id]);
  const p=await db.one('SELECT student_uuid FROM plaza_participants WHERE store_public_id=$1',[oldStore]);
  check(record.student_id===p.student_uuid&&record.program_ref===`job-deck:${fixture.deckId}`&&record.session_ref===`job-class:${fixture.classSessionId}`&&record.source_event_id===`job:${p.student_uuid}:${preview.attempt_id}`,'기존 실제 자료·수업·학생·시도 규격');
  check(record.verification_status===null&&record.raw_data.job.entry_kind==='student_reflection'&&record.raw_data.job.plaza.snapshot_digest===preview.digest,'기존 학생 기록 의미와 미검증 유지');
  check((await db.one('SELECT count(*)::int AS n FROM career_log.records')).n===1,'아직 미완료인 학생 기록 자동 생성 없음');
  const ordinary=await ok(students[0].request('GET','/api/career-log/records'),'기존 진로기록 목록');check(ordinary.records.some(r=>r.id===saved.record_id),'기존 목록에서 최종 기록 조회');
  // Existing role, deck lock and session restrictions also guard every stage-2 endpoint.
  const {hashPassword}=require('../lib/password');
  for(const role of ['instructor','partner']){
    const user={username:'plaza2-test-'+role,password:crypto.randomBytes(18).toString('hex')};
    await db.q('INSERT INTO users(username,password_hash,name,role,agreed_version,must_change_password) VALUES($1,$2,$3,$4,1,false)',[user.username,hashPassword(user.password),'다른 계정',role]);
    const j=jar();await ok(j.request('POST','/api/login',user),'비담당 계정 로그인');check((await j.request('GET',r+'/slides')).status===403,'비담당 강사·partner 교안 차단');check((await j.request('GET',r+'/teacher')).status===403,'비담당 현황 차단');
  }
  await db.q('UPDATE session_items SET unlocked=false WHERE session_id=$1 AND deck_id=$2',[fixture.classSessionId,fixture.deckId]);
  check((await students[0].request('GET',r+'/board')).status===403,'기존 자료 잠금 광장 조회 차단');check((await teacher.request('GET',r+'/slides')).status===403,'기존 자료 잠금 교안 차단');
  await db.q('UPDATE session_items SET unlocked=true WHERE session_id=$1 AND deck_id=$2',[fixture.classSessionId,fixture.deckId]);
  const beforeClose=await info();check((await teacher.request('POST',r+'/state',{state:'closed',version:beforeClose.room.version})).status===400,'기록 미완료 종료 사유 필요');
  await change('closed',r,{reason:'시험에서 미완료 학생 유지 확인'});
  check((await students[0].request('GET',r+'/photos/'+capture)).status===401,'종료 즉시 전시 사진 차단');
  check((await students[0].request('POST',r+'/record',finalBody)).status===401,'종료 후 저장 재시도 차단');
  check((await db.one('SELECT count(*)::int AS n FROM career_log.records')).n===1,'종료해도 미완료 기록 생성 없음');
  // A separate one-person room verifies substitution without falsifying peer authorship.
  const cs=await db.one("INSERT INTO class_sessions(code,title,created_by,instructor_id,expires_at) VALUES($1,'1인 시험',$2,$2,now()+interval '2 hours') RETURNING id,code",[String(crypto.randomInt(100000,1000000)),fixture.teacher.id]);
  await db.q('INSERT INTO session_items(session_id,deck_id) VALUES($1,$2)',[cs.id,fixture.deckId]);
  const soloId=crypto.randomUUID();await db.q('INSERT INTO plaza_rooms(id,class_session_id,deck_id,program_version_id,seat_count) SELECT $1,$2,deck_id,program_version_id,30 FROM plaza_rooms WHERE id=$3',[soloId,cs.id,fixture.roomId]);
  const soloRoom=`/api/plaza/rooms/${soloId}`,solo=jar();
  await change('paused',soloRoom);await change('returning',soloRoom);
  const emptyInfo=await info(soloRoom);check((await teacher.request('POST',soloRoom+'/state',{state:'exchange',version:emptyInfo.room.version,participant_ids:[]})).status===409,'0명 개장 거절');
  // Reset a never-opened fixture only in the disposable test DB.
  await db.q("UPDATE plaza_rooms SET state='planning' WHERE id=$1",[soloId]);
  await ok(solo.request('POST','/api/join',{code:cs.code,name:'시험 학생 혼자'}),'1인 입장');await ok(solo.request('POST',soloRoom+'/enter',{mode:'new',seat_order:1}),'1인 연결');await plan(solo,'혼자',soloRoom);
  await change('paused',soloRoom);await change('returning',soloRoom);let sm=await mine(solo,soloRoom);
  await ok(solo.request('PUT',soloRoom+'/activity',{kind:'actual',attempt_id:crypto.randomUUID(),version:sm.activity.version,result:'not_made',note:'설명 활동만 했어요.'}),'미제작 사실');await change('exchange',soloRoom);
  sm=await mine(solo,soloRoom);check(sm.exchange.outgoing.substitute&&sm.exchange.incoming.request.source==='example','예시 손님 명시');
  await ok(solo.request('POST',soloRoom+'/message',{kind:'request',attempt_id:crypto.randomUUID(),request_id:'gift'}),'예시 가게에 요청');
  await ok(solo.request('POST',soloRoom+'/ai',{kind:'reply',attempt_id:crypto.randomUUID()}),'예시 요청 답장 초안');
  await ok(solo.request('POST',soloRoom+'/message',{kind:'reply',attempt_id:crypto.randomUUID(),text:'사용 방법을 함께 확인해 볼까요?'}),'예시 손님에게 학생 답장');
  sm=await mine(solo,soloRoom);check(sm.exchange.outgoing.reply.source==='example'&&sm.exchange.incoming.reply.source==='student'&&sm.exchange.incoming.reaction.source==='example','대체 진행 주체 분리');
  await ok(solo.request('POST',soloRoom+'/message',{kind:'reaction',attempt_id:crypto.randomUUID(),reaction_id:'understood'}),'예시 답장에 반응');await change('reflection',soloRoom);sm=await mine(solo,soloRoom);
  await ok(solo.request('PUT',soloRoom+'/activity',{kind:'reflection',attempt_id:crypto.randomUUID(),version:sm.activity.version,answers:['설명하기','도움받기','다른 향']}),'1인 돌아보기');
  const sr=await ok(solo.request('POST',soloRoom+'/record-preview',{}),'대체 기록 확인');check(sr.snapshot.process.includes('예시 손님과 대체 진행')&&sr.snapshot.process.includes('제작하지 않음'),'대체·미제작 사실 최종 내용');
  await ok(solo.request('POST',soloRoom+'/record',{attempt_id:sr.attempt_id,digest:sr.digest}),'대체 기록 저장');
  const soloInfo=await info(soloRoom);check(soloInfo.counts.peer_complete===0&&soloInfo.counts.substitute_complete===1,'또래 교류·대체 완료 집계 구분');
  const newTables=await db.q("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('plaza_activities','plaza_ai_runs','plaza_visits','plaza_record_receipts','plaza_teacher_materials')");
  check(newTables.length===5&&newTables.every(t=>t.relrowsecurity),'새 표 5개 RLS');
  for(const tbl of newTables)check(!(await db.one("SELECT has_table_privilege('anon',$1,'SELECT') AS allowed",[tbl.relname])).allowed,'직접 익명 접근 차단 '+tbl.relname);
  console.log(JSON.stringify({stage:2,checks,status:'passed',records:2}));return {checks,records:2};
}
module.exports={verify};
if(require.main===module)verify().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
