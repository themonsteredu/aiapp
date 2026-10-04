/* Teacher recovery controls stay mounted while status polling refreshes the roster. */
export function createPlazaRecovery({root,request,esc,onChanged,onMove,onMoveStart,onMoveCancelled,onFatal}) {
  let data,disposed=false,busy=false,codeTimer;
  const pending=new Map(),$=name=>root.querySelector(`[data-recovery="${name}"]`);
  root.innerHTML=`<h2>접속과 사진 복구</h2><p>참여자와 두 가게를 직접 확인한 뒤 진행해 주세요. 이미 보낸 교류와 최종 기록은 유지됩니다.</p>
    <label>참여자<select data-recovery="participant"></select></label><div class="plaza-controls"><button class="btn btn-ghost" data-recovery="reissue">기기 접속 재발급</button><button class="btn btn-ghost" data-recovery="attendance">결석·복귀 확인</button></div>
    <p data-recovery="code" class="plaza-reissue-code" role="status" hidden></p><p class="plaza-help">연결값은 5분 동안 한 번만 사용할 수 있습니다. 새 기기에서 같은 수업 코드로 들어온 뒤 입력해 주세요. 화면을 벗어나면 연결값을 감춥니다.</p>
    <label>옮길 사진<select data-recovery="photo"></select></label><label>사진을 받을 가게<select data-recovery="destination"></select></label><button class="btn btn-ghost" data-recovery="move">사진 옮기기</button>
    <p data-recovery="message" role="status"></p><details><summary>인터넷이 끊겼을 때</summary><p>구상과 교류는 종이로 이어갈 수 있습니다. 자리, 방문할 가게, 요청·답장·반응을 적고 종이 활동임을 표시해 주세요. 연결이 돌아오면 학생이 자신의 내용을 확인해 입력합니다. 화면이나 종이에 쓴 것만으로 서버에 저장되지는 않습니다. 종료한 수업에 대신 입력하지 않습니다.</p><button class="btn btn-ghost" data-recovery="paper">종이 활동 카드 준비하기</button><section data-recovery="paper-content"></section></details>`;
  function note(value){$('message').textContent=value;}
  function clearCode(){clearTimeout(codeTimer);$('code').textContent='';$('code').hidden=true;}
  function lock(){root.querySelectorAll('select,button').forEach(el=>el.disabled=busy||data?.room.state==='closed');
    if(pending.size)root.querySelectorAll('select').forEach(el=>el.disabled=true);
    for(const key of ['reissue','attendance','move'])$(key).disabled=busy||data?.room.state==='closed'||(pending.size>0&&!pending.has(key));
  }
  async function action(key,suffix,makeBody,done){
    if(busy||disposed)return;
    if(!pending.has(key)){const body=makeBody();if(!body)return;pending.set(key,{...body,attempt_id:crypto.randomUUID()});if(key==='move')onMoveStart?.(body);}
    busy=true;lock();const body=pending.get(key);
    try{const result=await request('POST',suffix,body);if(disposed)return;pending.delete(key);await done(result,body);await onChanged();}
    catch(error){if(disposed)return;if([401,403,404].includes(error.status)){onFatal(error);return;}
      if(error.status&&error.status<500){pending.delete(key);if(key==='move')onMoveCancelled?.(body);}
      note(error.status&&error.status<500?error.message:'처리 확인 필요 · 같은 버튼으로 다시 확인해 주세요.');}
    finally{busy=false;if(!disposed)lock();}
  }
  const participant=()=>data.participants.find(p=>p.id===$('participant').value);
  $('reissue').onclick=()=>action('reissue','/reissue',()=>{
    const p=participant();if(!p)return;
    if(p.attendance!=='present'){note('먼저 복귀를 확인해 주세요.');return;}
    if(!confirm(`${p.seat_order}번 · ${p.store_name||'가게'}의 접속을 재발급할까요? 이전 기기의 로그인도 끝납니다.`))return;
    clearCode();return {participant_id:p.id,connection_version:p.connection_version,confirm:true};
  },result=>{clearCode();if(result.code){$('code').textContent=`새 기기 연결값: ${result.code}`;$('code').hidden=false;codeTimer=setTimeout(clearCode,Math.max(0,new Date(result.expires_at)-Date.now()));note('이전 접속을 끝냈습니다. 해당 학생에게만 연결값을 보여 주세요.');}
    else note('재발급은 완료됐지만 연결값 원문은 보관하지 않습니다. 학생이 받지 못했다면 재발급 버튼을 새로 눌러 주세요.');});
  $('attendance').onclick=()=>action('attendance','/attendance',()=>{
    const p=participant();if(!p)return;const next=p.attendance==='present'?'absent':'present';
    const reason=prompt(`${p.seat_order}번 학생의 ${next==='absent'?'결석·중도 이탈':'복귀'} 사유를 짧게 적어 주세요. 시작하지 않은 방문만 조정합니다.`);if(!reason?.trim())return;
    return {participant_id:p.id,attendance:next,version:p.attendance_version,reason:reason.trim()};
  },result=>{clearCode();note(result.attendance==='absent'?`결석을 반영했습니다. 시작 전 방문 ${result.retired_count}건을 조정했습니다. 기존 메시지는 보존됩니다.`:'복귀를 확인했습니다. 기기 접속을 재발급해 같은 가게를 이어 주세요.');});
  $('move').onclick=()=>action('move','/photo-move',()=>{
    const f=data.photos.find(p=>p.id===$('photo').value),target=data.participants.find(p=>p.id===$('destination').value),source=data.participants.find(p=>p.id===f?.participant_id);
    if(!f||!target||!source||source.id===target.id){note('서로 다른 두 가게를 확인해 주세요.');return;}
    if(target.photo_allowed===false||source.photo_allowed===false){note('사진 없이 참여하는 학생은 사진을 옮길 수 없습니다.');return;}
    if(!confirm(`${source.seat_order}번 · ${source.store_name||'가게'}의 사진을 ${target.seat_order}번 · ${target.store_name||'가게'}로 옮길까요? 이전 가게 전시가 내려갑니다.`))return;
    return {capture_id:f.id,participant_id:target.id,source_version:source.target_version,target_version:target.target_version,confirm:true};
  },async(result,body)=>{await onMove(result,body);note(result.saved?'사진을 옮겨 서버 저장을 확인했습니다.':'사진 대상을 바꿨습니다. 기기에 남은 사진을 보내거나 새로 촬영해 주세요.');});
  $('paper').onclick=async()=>{
    try{const {card}=await request('GET','/paper');if(disposed)return;const sections=[['손님 카드',card.customers],['허용 재료',card.materials],['요청 카드',card.requests],['준비된 답장 예시',card.reply_options],['반응',card.reactions]];
      const lines=['조향사 광장 · 종이 활동','자리: ______   방문할 가게: ______','서버 저장 전입니다. 본인이 확인해 재접속 후 입력합니다.',...sections.flatMap(([title,items])=>[title,...items.map(v=>v.text||v.title)]),'내가 바꾼 답장: ____________________','기억에 남는 일: ____________________','막혔을 때 한 일: ____________________','더 알고 싶은 것: ____________________'];
      $('paper-content').innerHTML=`<p>수업 전 미리 저장해 두세요. 예시 답장은 예시로 표시하고, 학생이 바꾼 답장을 별도로 적습니다.</p><pre class="plaza-preserve">${esc(lines.join('\n'))}</pre><button class="btn btn-ghost" data-download-paper>활동지 텍스트 저장</button>`;
      root.querySelector('[data-download-paper]').onclick=()=>{const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='plaza-paper-rehearsal.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    }catch(error){note(error.message);}
  };
  function options(el,items){const previous=el.value,html=items.map(item=>`<option value="${esc(item.id)}">${esc(item.label)}</option>`).join('');if(el.dataset.options!==html){el.innerHTML=html;el.dataset.options=html;if(items.some(i=>i.id===previous))el.value=previous;}}
  return {update(next){if(disposed)return;data=next;if(next.room.state==='closed')clearCode();const people=next.participants.map(p=>({id:p.id,label:`${p.seat_order}번 · ${p.store_name||'이름 준비 중'} · ${p.attendance==='absent'?'결석':'참여'}`}));options($('participant'),people);options($('destination'),people);
    options($('photo'),next.photos.filter(f=>!f.invalidated_at&&(f.status!=='stored'||next.participants.some(p=>p.current_photo_id===f.id))).map(f=>({id:f.id,label:`${next.participants.find(p=>p.id===f.participant_id)?.seat_order}번 · ${f.status==='stored'?'서버 저장 완료':'저장 확인 필요'} · ${f.id.slice(0,8)}`})));lock();},hideSecrets:clearCode,hasPending:()=>pending.size>0,destroy(){disposed=true;clearCode();pending.clear();root.replaceChildren();}};
}
