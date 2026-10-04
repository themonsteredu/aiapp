'use strict';
// Synthetic clients use the normal class-code HTTP API. Credentials stay outside the repository.
const crypto=require('node:crypto'),fs=require('node:fs/promises'),path=require('node:path');
const {plazaConfig}=require('../lib/plaza-config');
function client(base,cookiePairs=[]) {
  const url=new URL(base);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw new Error('로컬 시험 서버만 이용합니다.');
  const cookies=new Map(cookiePairs);
  return {cookies,async request(method,url,body,{keepCookies=true}={}){
    const res=await fetch(base+url,{method,headers:{cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(keepCookies)for(const line of res.headers.getSetCookie()){const pair=line.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return {status:res.status,headers:res.headers,data:res.headers.get('content-type')?.includes('application/json')?await res.json():Buffer.from(await res.arrayBuffer())};
  }};
}
async function ok(response){const r=await response;if(r.status!==200)throw new Error(`시험 요청 실패 (${r.status}): ${r.data.error||'응답 확인 필요'}`);return r.data;}
async function prepare({base,fixture,count=5,choices=[]}) {
  if(!plazaConfig()?.stage3||!Number.isInteger(count)||count<1||count>30)throw new Error('3단계에서 가짜 참여자 1~30명을 준비합니다.');
  const teacher=client(base);await ok(teacher.request('POST','/api/login',fixture.teacher));
  const room=`/api/plaza/rooms/${fixture.roomId}`,initial=await ok(teacher.request('GET',room+'/teacher'));
  if(initial.room.state!=='planning'||initial.participants.length)throw new Error('비어 있는 시험 광장에서만 가짜 참여자를 만듭니다.');
  const people=[];
  for(let i=1;i<=count;i++){
    const person=client(base);await ok(person.request('POST','/api/join',{code:fixture.code,name:`리허설 가짜 참여자 ${i}`}));
    const joined=await ok(person.request('POST',room+'/enter',{mode:'new',seat_order:i,attempt_id:crypto.randomUUID(),...(plazaConfig().stage4?{record_choice:choices[i-1]?.record_choice||'record',photo_allowed:choices[i-1]?.photo_allowed??true,notice_version:'stage4-test-1'}:{})}));
    if(joined.card.materials_status!=='test-approved')throw new Error('가짜 키트 선택지에서만 자동 리허설합니다.');
    const ideas=await ok(person.request('POST',room+'/ai',{kind:'ideas',customer_id:joined.card.customers[0].id,material_ids:joined.card.materials.map(m=>m.id),attempt_id:crypto.randomUUID()}));
    const draft={version:0,attempt_id:crypto.randomUUID(),idea_id:ideas.output.ideas[0].id,combination_id:ideas.output.ideas[0].combination_id,introduction_id:joined.card.introductions.find(v=>v.id!==ideas.output.ideas[0].introduction_id).id,artwork_seed_id:joined.card.names.artwork[0].id,artwork_name:`리허설 작품 ${i}`,store_seed_id:joined.card.names.store[0].id,store_name:`리허설 가게 ${i}`};
    await ok(person.request('PUT',room+'/draft',draft));people.push({seat:i,client:person,joined,draft});
  }
  return {teacher,people,room};
}
async function advance({people,room}) {
  const view=async p=>ok(p.client.request('GET',room+'/mine'));
  const send=async(p,path,body)=>ok(p.client.request('POST',room+path,{attempt_id:crypto.randomUUID(),...body}));
  for(const p of people){const m=await view(p);if(['returning','exchange','reflection'].includes(m.room.state)&&!m.activity.actual)await ok(p.client.request('PUT',room+'/activity',{attempt_id:crypto.randomUUID(),kind:'actual',version:m.activity.version,result:'not_made',note:'가짜 참여자로 설명 흐름만 리허설했습니다.'}));}
  for(const p of people){const m=await view(p);if(['exchange','reflection'].includes(m.room.state)&&m.exchange.outgoing&&!m.exchange.outgoing.request)await send(p,'/message',{kind:'request',visit_id:m.exchange.outgoing.id,request_id:m.card.requests[0].id});}
  for(const p of people){const m=await view(p);if(['exchange','reflection'].includes(m.room.state)&&m.exchange.incoming?.request&&!m.exchange.incoming.reply){
    await send(p,'/ai',{kind:'reply',visit_id:m.exchange.incoming.id});await send(p,'/message',{kind:'reply',visit_id:m.exchange.incoming.id,text:`리허설 답장 ${p.seat} · 키트 설명을 함께 읽어 볼까요?`});}}
  for(const p of people){let m=await view(p);if(['exchange','reflection'].includes(m.room.state)&&m.exchange.outgoing?.reply&&!m.exchange.outgoing.reaction)await send(p,'/message',{kind:'reaction',visit_id:m.exchange.outgoing.id,reaction_id:m.card.reactions[0].id});
    if(m.room.state==='reflection'){
      if(!m.activity.reflection)await ok(p.client.request('PUT',room+'/activity',{attempt_id:crypto.randomUUID(),kind:'reflection',version:m.activity.version,answers:['가짜 참여자 리허설입니다.','예외 처리를 확인했습니다.','실제 학생 활동이 아닙니다.']}));
      m=await view(p);if(m.exchange.outgoing?.reaction&&m.exchange.incoming?.reply){if(m.privacy?.record_choice==='no-record'){if(!m.privacy.activity_completed_at)await send(p,'/finish',{});}else{const receipt=m.receipt||await send(p,'/record-preview',{});if(!receipt.saved)await ok(p.client.request('POST',room+'/record',{attempt_id:receipt.attempt_id,digest:receipt.digest}));}}
    }
  }
}
async function main(){
  const config=plazaConfig();if(!config?.stage3||process.env.PLAZA_REHEARSAL_CONFIRM!=='synthetic-only')throw new Error('3단계 시험 환경과 PLAZA_REHEARSAL_CONFIRM=synthetic-only가 필요합니다.');
  const db=require('../lib/db');await db.ready();const marker=await db.one('SELECT test_id FROM plaza_environment WHERE database_name=current_database()');
  if(marker?.test_id!==config.testId)throw new Error('시험 DB 표식이 다릅니다.');
  const base=`http://127.0.0.1:${Number(process.env.PORT)||3999}`,fixture=JSON.parse(await fs.readFile(path.join(config.storageRoot,'fixture.json'),'utf8'));
  const file=path.join(config.storageRoot,'rehearsal-clients.json');let group;
  if(process.argv[2]==='--prepare'){
    group=await prepare({base,fixture,count:Number(process.argv[3]||5)});
    await fs.writeFile(file,JSON.stringify({testId:config.testId,roomId:fixture.roomId,people:group.people.map(p=>({seat:p.seat,cookies:[...p.client.cookies]}))}),{mode:0o600,flag:'wx'});
    console.log(`가짜 참여자 ${group.people.length}명의 구상을 준비했습니다. 강사 화면에서 단계를 연 뒤 --continue를 실행하세요.`);
  }else if(process.argv[2]==='--continue'){
    const saved=JSON.parse(await fs.readFile(file,'utf8'));if(saved.testId!==config.testId||saved.roomId!==fixture.roomId)throw new Error('다른 리허설의 접속 파일입니다.');
    group={room:`/api/plaza/rooms/${fixture.roomId}`,people:saved.people.map(p=>({seat:p.seat,client:client(base,p.cookies)}))};await advance(group);console.log('현재 단계에서 가능한 가짜 참여자 활동을 확인했습니다.');
  }else throw new Error('--prepare 5 또는 --continue를 사용해 주세요.');
}
module.exports={client,ok,prepare,advance};
if(require.main===module)main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
