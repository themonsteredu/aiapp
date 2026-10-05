'use strict';
// Disposable local data only; no external app, AI request or production student data is used.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {plazaConfig}=require('../lib/plaza-config');
const {client,ok,advance}=require('./plaza-rehearsal');
const uuid=()=>crypto.randomUUID();
async function verify({base='http://127.0.0.1:3999',fixture}={}) {
  if(!plazaConfig()?.stage5||plazaConfig().online)throw new Error('별도 로컬 5단계 시험 환경에서만 확인합니다.');
  const db=require('../lib/db'),teacher=client(base),admin=client(base),anon=client(base);
  let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
  await ok(teacher.request('POST','/api/login',fixture.teacher));await ok(admin.request('POST','/api/login',fixture.admin));
  const catalog=await ok(teacher.request('GET','/api/plaza/programs'));
  const card={...catalog.synthetic_templates.find(c=>c.program_key==='perfumer-gypsum'),version:405};
  const deck=await ok(teacher.request('POST','/api/decks',{title:'연결 흐름 가짜 수업',kind:'link',external_url:'https://job.moakit.ai/class'}));
  await ok(teacher.request('PATCH',`/api/decks/${deck.id}`,{published:true}));
  const cs=await ok(teacher.request('POST','/api/class-sessions',{title:'조향사 연결 가짜 반',deck_ids:[deck.id],duration_minutes:180}));
  const program=await ok(teacher.request('POST','/api/plaza/programs',{deck_id:deck.id,card}));
  const setup=await ok(teacher.request('POST','/api/plaza/rooms',{class_session_id:cs.id,program_version_id:program.id,seat_count:3}));
  const room=`/api/plaza/rooms/${setup.id}`;
  await ok(admin.request('POST',room+'/retention/policy',{photo_hours:1,activity_hours:2,audit_hours:3,confirm_test_only:true}));
  const people=[];
  for(let i=0;i<3;i++) {
    const person=client(base);await ok(person.request('POST','/api/join',{code:cs.code,name:`가짜 연결 참여자 ${i+1}`}));
    const joined=await ok(person.request('POST',room+'/enter',{mode:'new',seat_order:i+1,attempt_id:uuid(),record_choice:i===2?'no-record':'record',photo_allowed:false,notice_version:'stage4-test-1'}));
    people.push({seat:i+1,client:person,joined});
  }
  const mine=p=>ok(p.client.request('GET',room+'/mine'));
  const info=()=>ok(teacher.request('GET',room+'/teacher'));
  const first=people[0],source=first.joined.source_activity;
  check(source.url==='https://ai-smell.vercel.app/'&&!source.url.includes(cs.code),'앱 주소에 반 코드·학생 정보 없이 확인된 외부 주소만 제공');
  const confirm={version:0,attempt_id:uuid(),adapter_id:source.id,adapter_version:source.version,mode:'app',inspiration_id:'calm',confirm:true};
  check((await anon.request('PUT',room+'/source-activity',confirm)).status===401,'익명 사용자의 영감 저장 차단');
  check((await teacher.request('PUT',room+'/source-activity',confirm)).status===403,'강사가 학생 영감 저장을 대신하지 못함');
  const ideasBody={kind:'ideas',customer_id:card.customers[0].id,material_ids:card.materials.map(m=>m.id),attempt_id:uuid()};
  check((await first.client.request('POST',room+'/ai',ideasBody)).data.code==='source_activity_required','영감 확인 전 구상 진행 차단');
  check((await first.client.request('PUT',room+'/source-activity',{...confirm,reading:'개인 대화 원문'})).status===400,'외부 활동 원문·개인 질문 수집 차단');
  check((await first.client.request('PUT',room+'/source-activity',{...confirm,confirm:false})).status===400,'학생 확인 없는 자동 완료 차단');
  const stored=await ok(first.client.request('PUT',room+'/source-activity',confirm));
  const replay=await ok(first.client.request('PUT',room+'/source-activity',confirm));
  check(stored.version===1&&replay.duplicate&&replay.version===1,'영감 저장 응답 유실 재시도는 같은 저장 한 개');
  check((await first.client.request('PUT',room+'/source-activity',{...confirm,inspiration_id:'bright'})).data.code==='attempt_conflict','같은 저장 번호로 내용 바꾸기 차단');
  check((await mine(people[1])).draft.content.source_activity===undefined,'다른 학생에게 영감이 섞이지 않음');
  check(!(await mine(first)).draft.saved_at&&(await info()).counts.plan_missing===3,'영감만 확인한 학생을 구상 완료로 세지 않음');
  check((await ok(first.client.request('GET',room+'/board'))).stores.length===0,'영감만 저장한 빈 가게는 광장에 노출되지 않음');
  for(let i=0;i<people.length;i++) {
    const p=people[i];
    if(i)await ok(p.client.request('PUT',room+'/source-activity',{...confirm,attempt_id:uuid(),mode:'without-app',inspiration_id:i===1?'warm':'fresh'}));
    const before=await mine(p),ideas=await ok(p.client.request('POST',room+'/ai',{...ideasBody,attempt_id:uuid()}));
    const plan={version:before.draft.version,attempt_id:uuid(),idea_id:ideas.output.ideas[0].id,combination_id:ideas.output.ideas[0].combination_id,
      introduction_id:card.introductions.find(c=>c.id!==ideas.output.ideas[0].introduction_id).id,
      artwork_seed_id:card.names.artwork[0].id,artwork_name:`가짜 연결 작품 ${i+1}`,store_seed_id:card.names.store[0].id,store_name:`가짜 연결 가게 ${i+1}`};
    await ok(p.client.request('PUT',room+'/draft',plan));
  }
  check((await mine(first)).draft.content.source_activity.inspiration_id==='calm','간판과 구상 저장 후에도 앞 활동 영감 보존');
  check((await first.client.request('PUT',room+'/source-activity',{...confirm,attempt_id:uuid(),version:2,inspiration_id:'warm'})).data.code==='source_activity_frozen','구상에 사용한 영감은 뒤늦게 덮어쓰지 못함');
  check((await ok(first.client.request('PUT',room+'/source-activity',confirm))).duplicate,'후속 구상 저장 뒤에도 앞 영감 저장 재시도 확인');
  const aiRows=await db.q('SELECT input FROM plaza_ai_runs WHERE room_id=$1',[setup.id]);
  check(!JSON.stringify(aiRows).match(/source_activity|inspiration|ai-smell|가짜 연결/),'AI로 학생 영감·앱 대화·가게 이름을 보내지 않음');
  const reconnect=client(base,[...first.client.cookies]);
  check((await ok(reconnect.request('GET',room+'/mine'))).draft.content.source_activity.inspiration_id==='calm','같은 접속으로 새로 열면 저장한 영감 복원');
  const phase=async state=>{const current=await info();return ok(teacher.request('POST',room+'/state',{state,version:current.room.version,participant_ids:current.participants.map(p=>p.id),reason:'가짜 연결 시험'}));};
  await phase('paused');
  check((await first.client.request('PUT',room+'/source-activity',{...confirm,attempt_id:uuid(),version:2})).data.code==='phase_conflict','제작 중에는 앞 활동 저장 차단');
  const group={teacher,room,people};await phase('returning');await advance(group);await phase('exchange');await advance(group);await phase('reflection');await advance(group);
  const completed=await mine(first),alternate=await mine(people[1]),declined=await mine(people[2]);
  check(completed.receipt.saved&&alternate.receipt.saved,'기존 활동 확인 → 구상 → 제작 확인 → 교류 → 성찰 → 진로기록 저장 완료');
  check(declined.privacy.activity_completed_at&&!declined.receipt,'기록을 원하지 않는 학생도 같은 연결 흐름으로 활동 완료');
  const record=await db.one('SELECT * FROM career_log.records WHERE id=$1',[completed.receipt.record_id]);
  const other=await db.one('SELECT * FROM career_log.records WHERE id=$1',[alternate.receipt.record_id]);
  check(record.raw_data.job.plaza.planning.decision.source_activity.source==='student-confirmed'&&record.process.includes('학생이 확인'),'최종 기록에 자동 수집으로 오인하지 않는 학생 확인 출처');
  check(other.process.includes('기존 앱 없이 강사 안내'),'앱을 쓰지 않은 활동의 대체 출처 구분');
  check(record.program_ref===`job-deck:${deck.id}`&&record.session_ref===`job-class:${cs.id}`,'기존 진로기록 자료·수업 규격 유지');
  check((await ok(first.client.request('GET',`/api/career-log/records/${record.id}/card`))).record.process===record.process,'QR 진로 카드에도 연결된 활동 과정 표시');
  check((await first.client.request('PUT',room+'/source-activity',{...confirm,attempt_id:uuid(),version:2})).status===409,'최종 확정 뒤 앞 활동 변경 차단');
  await phase('closed');
  const closed=await first.client.request('GET',room+'/mine');
  assert.equal(closed.status,401,'종료하면 학생 로그인도 폐기됨');
  check(!closed.data.draft,'수업 종료 후 연결 활동 열람 차단');
  return {checks};
}
module.exports={verify};
