/* Native wrapper: the external app never receives a student, room, session or grant value. */
export function mountActivitySource({root,source,confirmed,esc,onSave}) {
  if(!source){root.hidden=true;return {update(){},destroy(){}};}
  let disposed=false,canOpen=false;
  const $=key=>root.querySelector(`[data-source="${key}"]`);
  root.innerHTML=`<h2>기존 활동에서 작품의 영감을 가져와요</h2><p>${esc(source.title)}</p>
    <p>활동을 마치면 아래에서 가져갈 영감을 직접 확인해 주세요. 앱의 해석이나 대화는 자동으로 가져오지 않습니다.</p>
    <div class="plaza-controls"><button type="button" class="btn btn-primary" data-source="open">${esc(source.title)} 열기</button><button type="button" class="btn btn-ghost" data-source="close" hidden>활동 화면 닫기</button></div>
    <div class="plaza-activity-frame" data-source="frame" hidden></div>
    <p class="plaza-help">화면이 열리지 않으면 강사 안내로 아래의 분위기를 골라 이어갈 수 있어요. 활동 화면을 닫거나 새로고침하면 외부 앱의 진행은 처음부터 시작할 수 있습니다.</p>
    <form data-flow="source"><fieldset data-fields="source"><label>어떻게 활동했나요?<select name="mode" required><option value="">활동 방법 선택</option><option value="app">기존 앱 활동에서 영감을 골랐어요</option><option value="without-app">기존 앱 없이 강사 안내로 골랐어요</option></select></label>
      <label>${esc(source.prompt)}<select name="inspiration_id" required><option value="">가져갈 영감 선택</option>${source.choices.map(c=>`<option value="${esc(c.id)}">${esc(c.text)}</option>`).join('')}</select></label>
      <p class="plaza-help">${esc(source.help)}</p><label class="plaza-source-confirm"><input type="checkbox" name="confirm" required>내 작품에 가져갈 영감을 확인했어요</label>
      <button class="btn btn-primary">영감 저장하고 작품 구상으로 이어가기</button></fieldset></form><p role="status" data-source="saved"></p>`;
  const form=root.querySelector('form');
  if(confirmed){form.elements.mode.value=confirmed.mode;form.elements.inspiration_id.value=confirmed.inspiration_id;form.elements.confirm.checked=true;}
  function close(){const frame=$('frame');frame.replaceChildren();frame.hidden=true;$('close').hidden=true;}
  $('open').onclick=()=>{
    if(disposed||!canOpen||$('frame').firstChild)return;
    const iframe=document.createElement('iframe');
    // This is a fixed reviewed external origin, never uploaded same-origin HTML.
    iframe.src=source.url;iframe.title=source.title;iframe.setAttribute('referrerpolicy','no-referrer');
    iframe.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms');
    iframe.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'");
    $('frame').append(iframe);$('frame').hidden=false;$('close').hidden=false;
  };
  $('close').onclick=()=>{if(confirm('기존 앱의 화면을 닫을까요? 저장한 영감은 광장에 남지만 앱 안의 진행은 다시 시작할 수 있습니다.'))close();};
  form.onsubmit=e=>{
    e.preventDefault();if(disposed)return;
    void onSave({adapter_id:source.id,adapter_version:source.version,mode:form.elements.mode.value,
      inspiration_id:form.elements.inspiration_id.value,confirm:form.elements.confirm.checked});
  };
  return {
    update(next,{busy=false,pending=false}={}){
      if(disposed)return;
      const saved=next.draft.content.source_activity;
      const frozen=!!next.receipt||!!next.privacy?.activity_completed_at;
      canOpen=next.room.state==='planning'&&!next.ai.ideas&&!frozen&&!busy&&!pending;
      $('open').disabled=!canOpen;
      if(next.room.state!=='planning'||next.ai.ideas||frozen)close();
      $('saved').textContent=saved?`내가 확인한 영감 · ${saved.inspiration} · 서버 저장 완료${saved.mode==='without-app'?' (강사 안내로 진행)':''}`:'가져갈 영감은 아직 저장 전입니다.';
    },
    destroy(){disposed=true;close();root.replaceChildren();},
  };
}
