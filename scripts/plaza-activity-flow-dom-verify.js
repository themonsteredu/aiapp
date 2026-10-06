'use strict';
// Optional QA runtime: point PLAZA_JSDOM_MODULE to an already available jsdom module.
const {JSDOM}=require(process.env.PLAZA_JSDOM_MODULE||'jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {templates}=require('../lib/plaza-card-catalog');
const {activitySource,activitySources}=require('../lib/plaza-activity-source');
const publicDir=path.join(__dirname,'../public');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;console.log('PASS',label);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function verify(width) {
  const dom=new JSDOM('<main id="root"></main>',{url:'https://preview.invalid/class#/plaza/room',runScripts:'outside-only'}),w=dom.window;
  w.innerWidth=width;w.HTMLElement.prototype.scrollIntoView=function(){};w.confirm=()=>true;
  w.eval(fs.readFileSync(path.join(publicDir,'plaza-activity-source.js'),'utf8').replace('export function mountActivitySource','window.mountActivitySource = function mountActivitySource'));
  w.eval(fs.readFileSync(path.join(publicDir,'plaza-student.js'),'utf8').replace(/import \{mountActivitySource\} from '[^']+';/,'').replace('export function createPlazaStudent','window.createPlazaStudent = function createPlazaStudent'));
  const card=templates({synthetic:true})[0],source=activitySource(card);
  let current={room:{id:'room',version:1,state:'planning',stage5:true},participant:{seat_order:1,store_public_id:'store'},draft:{version:0,content:{},saved_at:null},card,source_activity:source,activity:{version:0,actual:null,reflection:null},ai:{},exchange:{incoming:null,outgoing:null},receipt:null,photo_url:null};
  const root=w.document.getElementById('root'),$=name=>root.querySelector(`[data-flow="${name}"]`),calls=[];
  let loseResponse=true,dirty=false;
  const request=async(method,url,body)=>{
    if(url==='/mine')return structuredClone(current);
    if(url==='/source-activity'){
      calls.push(structuredClone(body));
      if(!current.draft.content.source_activity){current.room.version++;current.draft.version++;
        current.draft.content.source_activity={adapter_id:source.id,adapter_version:1,mode:body.mode,inspiration_id:body.inspiration_id,inspiration:source.choices.find(c=>c.id===body.inspiration_id).text,source:'student-confirmed',confirmed_at:'2026-10-05T10:00:00Z'};}
      if(loseResponse){loseResponse=false;throw new Error('simulated response loss');}
      return {saved:true,version:1,duplicate:true};
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
  const flow=w.createPlazaStudent({root,data:structuredClone(current),request,esc,onDirty:v=>{dirty=v;},onFatal:e=>{throw e;}});
  check(!$('source-section').hidden&&$('plan-section').hidden,'처음 입장하면 기존 활동부터 안내');
  check($('ideas').querySelector('fieldset').disabled&&!root.querySelector('iframe'),'영감 확인 전 구상 잠금, 외부 앱 자동 실행 없음');
  root.querySelector('[data-source="open"]').click();
  const iframe=root.querySelector('iframe');
  check(iframe.src==='https://ai-smell.vercel.app/'&&iframe.getAttribute('referrerpolicy')==='no-referrer','iframe에는 학생 정보 없이 고정 주소·참조 차단');
  check(!iframe.sandbox?.contains('allow-top-navigation')&&!iframe.getAttribute('sandbox').includes('allow-popups'),'외부 앱의 부모 이동·새 창 권한 차단');
  const form=$('source');form.elements.mode.value='app';form.elements.inspiration_id.value='calm';form.elements.confirm.checked=true;
  form.dispatchEvent(new w.Event('input',{bubbles:true}));
  current.room.version++;flow.update(structuredClone(current));
  check(root.querySelector('iframe')===iframe&&form.elements.inspiration_id.value==='calm','정기 갱신이 앱과 학생 선택을 다시 만들지 않음');
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  check(form.elements.mode.disabled&&$('ideas').querySelector('fieldset').disabled&&dirty,'응답 유실 때 같은 내용으로 재시도할 수 있게 보존');
  flow.update(structuredClone(current));
  check(!$('source-section').hidden&&$('ideas').querySelector('fieldset').disabled,'서버 갱신이 먼저 와도 불확실한 저장 재시도 유지');
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  check(JSON.stringify(calls[0])===JSON.stringify(calls[1]),'재시도는 같은 저장 번호·같은 선택');
  check($('source-section').hidden&&!$('plan-section').hidden&&!dirty,'확인 후 같은 화면에서 작품 구상으로 이동');
  check($('source-inspiration').textContent.includes('차분하고 은은')&&!$('ideas').querySelector('fieldset').disabled,'가져온 영감을 다시 입력하지 않고 구상에 표시');
  current.room.version++;current.room.state='paused';flow.update(structuredClone(current));
  check(!root.querySelector('iframe')&&$('source').querySelector('fieldset').disabled,'제작 전환 때 외부 앱을 닫고 저장 차단');
  flow.destroy();
  current.room.version++;current.room.state='planning';
  const resumed=w.createPlazaStudent({root,data:structuredClone(current),request,esc,onDirty(){},onFatal:e=>{throw e;}});
  check(!$('plan-section').hidden&&$('source').elements.inspiration_id.value==='calm','재입장하면 앞 활동 반복 없이 저장된 구상 단계 복원');
  resumed.destroy();check(!root.querySelector('iframe'),'화면 종료 시 외부 앱 제거');
  dom.window.close();
}
async function verifyPreparation(){
  const dom=new JSDOM('<div id="app"></div>',{url:'https://preview.invalid/class',runScripts:'outside-only'}),w=dom.window;
  w.confirm=()=>true;w.eval(fs.readFileSync(path.join(publicDir,'plaza-programs.js'),'utf8').replace('export async function mountPlazaPrograms','window.mountPlazaPrograms=async function mountPlazaPrograms'));
  const app=w.document.getElementById('app'),catalog={templates:templates(),synthetic_templates:templates({synthetic:true}),activity_sources:activitySources(),programs:[],decks:[{id:1,title:'시험 자료'}],sessions:[]};
  const view=await w.mountPlazaPrograms({esc,shell:(_title,html)=>{app.innerHTML=html;},api:async()=>structuredClone(catalog)});
  const $=key=>app.querySelector(`[data-program="${key}"]`);
  $('template').value='pending-0';$('load-template').click();
  check($('activity-source').value==='ai-smell:1'&&$('register').elements.version.value==='4','강사가 새 조향사 카드를 고르면 기존 활동 연결이 설정됨');
  $('activity-source').value='';$('activity-source').dispatchEvent(new w.Event('change'));
  check(!JSON.parse($('register').elements.card.value).source_activity,'강사가 기본 구상 화면으로 진행할 수도 있음');
  $('template').value='pending-1';$('load-template').click();
  check($('activity-source').options.length===1&&!JSON.parse($('register').elements.card.value).source_activity,'다른 공예에는 맞지 않는 조향사 앱을 연결하지 않음');
  view.destroy();dom.window.close();
}
async function verifyPreparationRecovery(){
  const dom=new JSDOM('<div id="app"></div>',{url:'https://preview.invalid/class#/plaza-programs',runScripts:'outside-only'}),w=dom.window;
  w.eval(fs.readFileSync(path.join(publicDir,'plaza-programs.js'),'utf8').replace('export async function mountPlazaPrograms','window.mountPlazaPrograms=async function mountPlazaPrograms'));
  const app=w.document.getElementById('app'),card=templates({synthetic:true})[0];
  const catalog={templates:templates(),synthetic_templates:[],activity_sources:activitySources(),programs:[{id:'program',version:4,deck_title:'조향사',card}],decks:[{id:1,title:'조향사'}],sessions:[]};
  let failure=null,reads=0;const writes=[];
  const view=await w.mountPlazaPrograms({esc,shell:(_title,html)=>{app.innerHTML=html;},api:async(method,url,body)=>{
    if(method==='GET'){reads++;return structuredClone(catalog);}
    writes.push(structuredClone(body));if(failure)throw failure;return {id:'room',duplicate:false};
  }});
  const $=key=>app.querySelector(`[data-program="${key}"]`);
  check($('prepare').elements.class_session_id.disabled&&$('prepare-submit').disabled&&$('session-help').textContent.includes('2시간'),'수업이 없으면 만료 조건을 안내하고 광장 준비 차단');
  check(app.querySelector('a[href="#/sessions"]')&&!$('refresh-sessions').disabled,'빈 목록에 코드 만들기·목록 새로고침 제공');
  $('register').elements.card.value='작성 중인 설정';
  catalog.sessions=[{id:9,title:'오늘 시험반',code:'123456'}];$('refresh-sessions').click();await tick();await tick();
  check(reads===2&&!$('prepare').elements.class_session_id.disabled&&!$('prepare-submit').disabled&&$('register').elements.card.value==='작성 중인 설정','목록 갱신은 새 수업을 표시하고 작성 중 설정 보존');
  const f=$('prepare').elements;f.class_session_id.value='9';f.program_version_id.value='program';f.seat_count.value='2';
  async function submit(){ $('prepare').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick(); }
  for(const code of ['class_expired','deck_unassigned','deck_blocked']){
    failure=Object.assign(new Error(`${code} <img src=x onerror=alert(1)>`),{status:403,data:{code}});await submit();
    check($('prepare-status').textContent===failure.message&&!$('prepare-status').querySelector('img')&&!$('prepare-help').hidden,`${code}: 실제 서버 이유를 안전한 텍스트로 표시하고 관리 링크 제공`);
    check(f.class_session_id.value==='9'&&f.program_version_id.value==='program'&&f.seat_count.value==='2'&&!$('prepare-submit').disabled&&!f.seat_count.disabled,`${code}: 화면·선택·인원을 유지하고 수정·재시도 허용`);
  }
  failure=new Error('응답 유실');await submit();
  check(f.seat_count.disabled&&!$('prepare-submit').disabled&&$('refresh-sessions').disabled,'저장 결과 미확인 때 제출 버튼만 재시도 가능');
  failure=null;await submit();
  check(JSON.stringify(writes.at(-1))===JSON.stringify(writes.at(-2))&&$('result').textContent.includes('광장을 준비했습니다.'),'응답 유실 재시도는 같은 요청을 보내고 서버 확인 뒤 완료 표시');
  failure=Object.assign(new Error('담당 강사만 이용할 수 있습니다.'),{status:403,data:{}});await submit();
  check(!$('prepare')&&app.textContent.includes(failure.message)&&app.querySelector('a[href="#/login"]'),'실제 권한 거절은 정보·폼을 지우고 구체적 이유와 로그인 경로 표시');
  const before=reads;await view.revalidate();check(reads===before,'권한 거절 후 자동 갱신으로 이전 설정 복원 금지');view.destroy();
  for(const status of [401,404]){
    const blocked=await w.mountPlazaPrograms({esc,shell:(_title,html)=>{app.innerHTML=html;},api:async()=>{throw Object.assign(new Error(status===401?'로그인이 필요합니다.':'찾을 수 없습니다.'),{status});}});
    check(app.textContent.includes(status===401?'로그인이 만료':'기능을 찾을 수 없습니다')&&!app.textContent.includes('프로그램 준비 권한을 다시'),'로그인 만료와 기능 없는 주소를 권한 오류로 뭉뚱그리지 않음');blocked.destroy();
  }
  dom.window.close();
}
(async()=>{for(const width of [390,768,1366])await verify(width);await verifyPreparation();await verifyPreparationRecovery();console.log(JSON.stringify({dom_checks:checks,widths:[390,768,1366],layout_rendering:'not verified'}));})().catch(error=>{console.error(error);process.exitCode=1;});
