'use strict';
// Optional QA runtime. This verifies camera state and upload wiring, not real device permissions or rendering.
const {JSDOM}=require(process.env.PLAZA_JSDOM_MODULE||'jsdom');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../public/plaza-ui.js'),'utf8').replace(/^import .*;$/gm,'').replace('export async function mountPlaza','window.mountPlaza=async function mountPlaza');
const jpeg=fs.readFileSync(path.join(__dirname,'../test/fixtures/plaza-photo.txt'),'utf8').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let checks=0;const check=(condition,label)=>{assert.ok(condition,label);checks++;console.log('PASS',label);};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const person=(seat,photo=true)=>({id:`person-${seat}`,seat_order:seat,target_version:1,store_name:`시험 가게 ${seat}`,photo_allowed:photo,saved_at:null});
function media(){const track={readyState:'live',stops:0,stop(){this.stops++;this.readyState='ended';}};return {track,getTracks:()=>[track],getVideoTracks:()=>[track]};}
async function setup({participants=[],unsupported=false,permission,playError=false,timeout=false,width=390}={}){
  const dom=new JSDOM('<div id="app"></div>',{url:'https://preview.invalid/class#/plaza-teacher/room',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.innerWidth=width;w.confirm=()=>true;w.isSecureContext=true;
  const stats={calls:[],requests:0,plays:0,pickers:[],revoked:0,decoded:0,draws:[]};
  const stream=media();
  if(!unsupported)Object.defineProperty(w.navigator,'mediaDevices',{value:{async getUserMedia(constraints){stats.requests++;stats.constraints=constraints;return permission?permission():stream;}}});
  Object.defineProperties(w.HTMLVideoElement.prototype,{videoWidth:{get(){return this._width||0;}},videoHeight:{get(){return this._height||0;}},readyState:{get(){return this._ready||0;}},paused:{get(){return this._paused!==false;}}});
  w.HTMLMediaElement.prototype.play=function(){stats.plays++;if(playError)return Promise.reject(new w.DOMException('play blocked','NotAllowedError'));this._paused=false;return Promise.resolve();};
  w.HTMLMediaElement.prototype.pause=function(){this._paused=true;this.dispatchEvent(new w.Event('pause'));};
  w.HTMLCanvasElement.prototype.getContext=function(){return {drawImage:(...args)=>stats.draws.push(args)};};
  w.HTMLCanvasElement.prototype.toDataURL=()=>jpeg;
  w.URL.createObjectURL=()=> 'blob:local-photo';w.URL.revokeObjectURL=()=>stats.revoked++;
  w.createImageBitmap=async()=>{throw new Error('simulated unsupported decoder');};
  w.Image=function(){const img=w.document.createElement('img');Object.defineProperties(img,{naturalWidth:{value:800},naturalHeight:{value:600},src:{set(){stats.decoded++;setTimeout(()=>img.onload?.(),0);}}});return img;};
  if(timeout){const schedule=w.setTimeout.bind(w);w.setTimeout=(fn,ms)=>schedule(fn,ms===10000?0:ms);}
  w.eval(source);
  const data={room:{id:'room',state:'planning',version:1,stage2:false,stage3:false},participants:structuredClone(participants),incomplete:participants.length,photos:[]};
  const view=await w.mountPlaza({roomId:'room',teacher:true,esc,shell:(_title,html)=>{w.document.getElementById('app').innerHTML=html;},api:async(method,url,body)=>{
    if(method==='GET')return structuredClone(data);
    stats.calls.push({method,url,body:structuredClone(body)});return {saved:true};
  }});
  const $=key=>w.document.querySelector(`[data-plaza="${key}"]`);
  for(const key of ['file','album-file'])$(key).click=()=>stats.pickers.push(key);
  function frame(){const video=$('video');video._width=1280;video._height=720;video._ready=2;video.dispatchEvent(new w.Event('canplay'));}
  return {w,dom,$,data,view,stats,stream,frame,close(){view.destroy();w.close();}};
}
async function normalFlow(width){
  const gate=deferred(),s=await setup({width,permission:()=>gate.promise}),{$,stats,data,view,w}=s;
  check(!$('camera').disabled&&$('capture').disabled&&$('device-camera').disabled,'학생 입장 전 미리보기 가능, 촬영은 잠금');
  check($('capture-help').textContent.includes('학생이 아직 입장'),'촬영할 수 없는 이유를 같은 위치에 안내');
  const opening=$('camera').onclick();await tick();await view.revalidate();
  check(stats.requests===1&&$('camera').disabled&&$('capture').disabled,'권한 대기 중 갱신해도 중복 카메라 요청·촬영 없음');
  gate.resolve(s.stream);await tick();
  check(stats.plays===1&&$('video').muted&&$('video').playsInline&&$('capture').disabled,'음소거·인라인 재생을 요청하고 실제 영상 전 촬영 잠금');
  s.frame();await opening;
  check($('capture').disabled&&$('video').srcObject===s.stream,'미리보기가 켜져도 학생 없는 사진 저장 차단');
  data.participants=[person(1),person(2)];await view.revalidate();
  check(!$('capture').disabled&&$('video').srcObject===s.stream,'학생 입장 후 재연결 없이 촬영 활성화');
  $('capture').click();await tick();await tick();
  check(stats.calls.length===2&&stats.calls[0].body.participant_id==='person-1'&&stats.calls[1].body.data_url===jpeg,'촬영한 사진은 선택한 자리로 예약·업로드');
  check($('target').value==='person-2'&&$('queue').textContent.includes('서버 저장 완료'),'다음 자리 이동과 서버 저장 결과 표시');
  $('device-camera').click();
  check(stats.pickers.at(-1)==='file'&&s.stream.track.stops===1&&$('file').getAttribute('capture')==='environment','기기 카메라를 열기 전에 실시간 카메라 해제');
  $('target').value='person-1';$('target').dispatchEvent(new w.Event('change'));
  Object.defineProperty($('file'),'files',{configurable:true,value:[new w.Blob(['fake photo'],{type:'image/jpeg'})]});
  $('file').dispatchEvent(new w.Event('change'));await tick();await tick();await tick();
  check(stats.calls[2].body.participant_id==='person-2','사진 선택 중 화면 대상이 바뀌어도 처음 선택한 자리에 저장');
  check(stats.decoded===1&&stats.revoked===1,'모바일 이미지 디코더 대체 경로와 임시 주소 정리');
  check(!$('album-file').hasAttribute('capture'),'사진 앨범 선택은 기기 카메라 강제 실행과 분리');
  data.participants[1].photo_allowed=false;await view.revalidate();
  check($('capture').disabled&&$('device-camera').disabled&&$('choose-photo').disabled&&$('capture-help').textContent.includes('사진 없이 참여'),'사진 없이 참여한 학생은 모든 촬영·선택 경로 차단');
  data.room.state='closed';await view.revalidate();
  check($('camera').disabled&&$('device-camera').disabled&&$('capture-help').textContent.includes('종료'),'수업 종료 뒤 카메라와 사진 선택 차단');
  s.close();
}
async function failureFlows(){
  let s=await setup({participants:[person(1)],unsupported:true});await s.$('camera').onclick();
  check(s.$('camera-status').textContent.includes('실시간 미리보기를 사용할 수 없')&&!s.$('device-camera').disabled,'미지원 브라우저 안내와 기기 카메라 대체 유지');s.close();
  for(const name of ['NotAllowedError','NotFoundError','NotReadableError']){
    s=await setup({participants:[person(1)],permission:()=>Promise.reject(Object.assign(new Error('device error'),{name}))});await s.$('camera').onclick();
    check(s.$('camera-status').textContent!=='device error'&&!s.$('camera').disabled&&s.$('capture').disabled,`${name} 원인 안내·재시도·촬영 잠금`);s.close();
  }
  s=await setup({participants:[person(1)],playError:true});await s.$('camera').onclick();
  check(s.stream.track.stops===1&&s.$('video').srcObject===null&&s.$('capture').disabled,'영상 재생 거절 때 검은 화면을 촬영하지 않고 스트림 해제');s.close();
  s=await setup({participants:[person(1)],timeout:true});await s.$('camera').onclick();
  check(s.$('camera-status').textContent.includes('영상이 도착하지')&&s.stream.track.stops===1,'권한만 허용되고 영상이 안 오면 대체 촬영 안내');s.close();
  let gate=deferred();s=await setup({participants:[person(1)],permission:()=>gate.promise});let opening=s.$('camera').onclick();s.data.room.state='closed';await s.view.revalidate();gate.resolve(s.stream);await opening;
  check(s.stream.track.stops===1&&s.$('video').srcObject===null,'권한 응답보다 수업 종료가 빠르면 늦게 도착한 카메라 해제');s.close();
  gate=deferred();s=await setup({participants:[person(1)],permission:()=>gate.promise});opening=s.$('camera').onclick();s.view.destroy();gate.resolve(s.stream);await opening;
  check(s.stream.track.stops===1&&!s.w.document.querySelector('video'),'화면 종료 후 늦게 도착한 카메라 해제');s.w.close();
  gate=deferred();const fresh=media();let first=true;s=await setup({participants:[person(1)],permission:()=>{if(first){first=false;return gate.promise;}return fresh;}});
  opening=s.$('camera').onclick();s.$('camera-stop').click();const retry=s.$('camera').onclick();await tick();s.frame();await retry;gate.resolve(s.stream);await opening;
  check(s.stream.track.stops===1&&fresh.track.stops===0&&s.$('video').srcObject===fresh&&!s.$('capture').disabled,'취소한 권한 요청의 늦은 응답이 새 미리보기를 덮어쓰지 않음');
  s.$('video').pause();check(s.$('capture').disabled,'영상이 멈추면 촬영도 즉시 잠금');s.close();
  check(fresh.track.stops===1,'화면 종료 때 사용 중 카메라 해제');
}
(async()=>{for(const width of [390,768,1366])await normalFlow(width);await failureFlows();console.log(JSON.stringify({camera_dom_checks:checks,real_device_camera:'not verified'}));})().catch(error=>{console.error(error);process.exitCode=1;});
