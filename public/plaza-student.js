/* Stage 2 native student flow. Polling updates status nodes, never rebuilds an input form. */
export function createPlazaStudent({root,data,request,esc,onDirty,onFatal}) {
  let state=data,disposed=false,boardVersion=-1,stores=[],pending=new Map(),dirty=new Set(),busy=false,displayPhase='';
  const card=data.card,$=key=>root.querySelector(`[data-flow="${key}"]`);
  const questions=['오늘 한 일 중 가장 기억에 남는 것','막혔을 때 나는 어떻게 했나','이 일에 대해 더 알고 싶은 것'];
  const option=(items,selected)=>items.map(v=>`<option value="${esc(v.id)}" ${v.id===selected?'selected':''}>${esc(v.title||v.text)}</option>`).join('');
  const sourceLabel=run=>run?.source==='ai'?'AI 제안':'준비된 예시';
  const status=(key,value)=>{if($(key))$(key).textContent=value;};
  const label=value=>({planning:'구상하기',paused:'제작 중 · 잠시 멈춤',returning:'다시 만나 작품 확인',exchange:'광장에서 교류하기',reflection:'돌아보기와 저장 확인'}[value]||'수업 종료');
  const changed=()=>onDirty(dirty.size>0||pending.size>0);
  function values(key){return Object.fromEntries(new FormData($(key)).entries());}
  async function action(key,method,path,body) {
    if(busy||disposed)return;
    busy=true;
    if(!pending.has(key))pending.set(key,{...body,attempt_id:body?.attempt_id||crypto.randomUUID()});
    changed();status('message','서버에서 확인하고 있습니다.');lock();
    try {
      const result=await request(method,path,pending.get(key));
      if(disposed)return;
      if(result.status==='running'){status('message','제안을 준비하고 있습니다. 잠시 뒤 같은 버튼을 눌러 주세요.');return result;}
      pending.delete(key);dirty.delete(key);changed();
      status('message',result.saved?'서버 저장 완료 · 확인했습니다.':'내용을 확인했습니다.');
      const fresh=await request('GET','/mine');if(!disposed)update(fresh);
      return result;
    }catch(error){
      if(disposed)return;
      if([401,403,404,410].includes(error.status)){onFatal(error);return;}
      if(error.status&&error.status<500)pending.delete(key);
      status('message',error.status&&error.status<500?error.message:'저장 확인 필요 · 같은 버튼으로 다시 확인해 주세요.');changed();
    }finally{busy=false;if(!disposed)lock();}
  }
  const d=data.draft.content,a=data.activity;
  root.innerHTML=`<header class="plaza-heading"><p class="plaza-kicker">모아킷 · 모아랩</p><h1>조향사 광장</h1><p data-flow="phase"></p></header>
    <p class="plaza-seat">내 자리 ${esc(data.participant.seat_order)}번</p><p>${esc(card.problem||'서로 다른 손님을 배려하는 제품과 설명을 생각해요.')}</p>
    <p class="plaza-pause-note" data-flow="kit">${card.materials_status==='test-approved'?'시험용 재료로 진행하는 개발 화면입니다. 실제 향 목록은 확인 대기입니다.':esc(card.materials_status)}</p>
    ${data.room.stage4?`<section aria-label="내 기록과 사진 선택"><p data-flow="privacy-status"></p><button type="button" class="btn btn-ghost" data-flow="withdraw-photo">작품 사진 사용 중지·삭제 요청</button><p data-flow="photo-purge" role="status"></p></section>`:''}
    <nav class="plaza-controls" aria-label="활동 이동">${[['plan-section','구상'],['actual-section','제작 확인'],['exchange-section','방문과 답장'],['reflection-section','돌아보기']].map(([id,title])=>`<button type="button" class="btn btn-ghost" data-jump="${id}">${title}</button>`).join('')}</nav>
    <p role="status" aria-live="polite" data-flow="message">쓴 내용은 저장 버튼을 눌러 서버 확인을 받아 주세요.</p>
    <section data-flow="plan-section"><h2>1. 손님을 생각하며 구상해요</h2>
      <form data-flow="ideas"><fieldset data-fields="ideas"><label>내 손님<select name="customer_id">${option(card.customers,d.customer_id||state.ai.ideas?.selection?.customer_id)}</select></label>
      <p>책상의 시향지를 맡고, 사용할 재료를 골라 주세요.</p><div class="plaza-materials">${(card.materials||[]).map(m=>`<label><input type="checkbox" name="material_ids" value="${esc(m.id)}" ${(d.material_ids||state.ai.ideas?.selection?.material_ids||[]).includes(m.id)?'checked':''}><span class="plaza-material-mark" aria-hidden="true">시향지</span><strong>${esc(m.title)}</strong><span>${esc(m.description)}</span></label>`).join('')}</div>
      <button class="btn btn-primary">두 구상 확인하기</button></fieldset></form>
      <p data-flow="ai-source"></p><div class="plaza-ideas" data-flow="idea-list"></div>
      <form data-flow="plan"><fieldset data-fields="plan"><label>내가 고른 구상<select name="idea_id" data-flow="idea-select"></select></label>
      <p>고른 안에서 재료 조합이나 소개를 한 가지 바꿔 보세요.</p>
      <label>확정할 재료 조합<select name="combination_id">${option(card.combinations||[],d.combination_id)}</select></label>
      <label>내가 확정한 소개<select name="introduction_id">${option(card.introductions||[],d.introduction_id)}</select></label>
      <div class="plaza-name-fields">${['artwork','store'].map(k=>`<div><label>${k==='artwork'?'작품':'가게'} 이름 후보<select name="${k}_seed_id">${option(card.names?.[k]||[],d[`${k}_seed_id`])}</select></label><label>후보를 바꾼 내 ${k==='artwork'?'작품':'가게'} 이름<input name="${k}_name" maxlength="40" required value="${esc(d[`${k}_name`]||'')}"></label></div>`).join('')}</div>
      <p class="plaza-help">이름·전화번호 같은 개인정보는 적지 마세요.</p><button class="btn btn-primary">간판과 구상 저장하기</button></fieldset></form><p data-flow="plan-saved"></p>
      <p class="plaza-pause-note" data-flow="pause-note" hidden>제작하러 가도 내 가게와 구상은 남아 있어요. 선생님이 다시 열면 이어서 해요.</p></section>
    <section class="plaza-step" data-flow="actual-section"><h2>2. 실제 작품과 구상을 비교해요</h2><div class="plaza-photo" data-flow="own-photo"></div>
      <form data-flow="actual"><fieldset data-fields="actual"><label>만들어 보니 어땠나요?<select name="result">${option([{id:'same',text:'구상대로 만들었어요'},{id:'changed',text:'만들면서 바꾼 것이 있어요'},{id:'not_made',text:'오늘 제작하지 않았어요'}],a.actual?.result)}</select></label>
      <label>시작 문장 도움<select data-flow="actual-help"><option value="">직접 적기</option><option>고른 구상대로 작품을 만들었어요.</option><option>만들면서 소개 문구를 바꿨어요.</option><option>작품 제작 대신 설명 활동을 했어요.</option></select></label><label>실제로 한 일을 짧게 적어 주세요<textarea name="note" rows="2" maxlength="200" required>${esc(a.actual?.note||'')}</textarea></label><button class="btn btn-primary">제작 결과 확인하기</button></fieldset></form><p data-flow="actual-saved"></p></section>
    <section class="plaza-step" data-flow="board-section"><div class="plaza-controls"><h2>우리 반 광장</h2><button type="button" class="btn btn-ghost" data-flow="my-store">내 가게</button><button type="button" class="btn btn-ghost" data-flow="visit-store">방문할 가게</button></div><p>간판을 누르면 가게 소개를 크게 볼 수 있어요. 작품 사진이 없어도 방문할 수 있어요.</p><div class="plaza-village" data-flow="village" aria-label="우리 반 가게 목록"></div><label>가게 이름으로 찾기<select data-flow="store-list"><option value="">가게 선택</option></select></label><article class="plaza-store-detail" data-flow="store-detail" hidden></article></section>
    <section class="plaza-step" data-flow="exchange-section"><h2>3. 한 가게를 방문하고 손님을 맞아요</h2><p data-flow="assignment"></p>${data.room.stage3?'<label class="plaza-help"><input type="checkbox" data-flow="paper-confirm">종이로 한 교류 내용을 내가 확인해 입력합니다.</label>':''}
      <form data-flow="request"><fieldset data-fields="request"><label>방문할 가게에 보낼 요청<select name="request_id">${option(card.requests||[])}</select></label><button class="btn btn-primary">요청 보내기</button></fieldset></form><p data-flow="sent-request"></p>
      <h3>내 가게에 도착한 요청</h3><p data-flow="incoming-request"></p><button type="button" class="btn btn-ghost" data-flow="reply-ai">답장 초안 한 번 확인하기</button><blockquote data-flow="reply-draft"></blockquote>
      <form data-flow="reply"><fieldset data-fields="reply"><label>도움이 필요하면 시작 문장을 골라 보세요<select data-flow="reply-help"><option value="">직접 적기</option>${option(card.reply_options||[])}</select></label><label>초안을 바꾼 내 답장<textarea name="text" maxlength="300" rows="3" required>${esc(data.exchange.incoming?.reply?.text||'')}</textarea></label><p class="plaza-help">향의 효능을 약속하지 말고, 키트에서 확인한 안내로 설명해 주세요.</p><button class="btn btn-primary">내 답장 보내기</button></fieldset></form><p data-flow="reply-saved"></p>
      <h3>내 요청에 온 답장</h3><blockquote data-flow="received-reply"></blockquote><form data-flow="reaction"><fieldset data-fields="reaction"><label>답장을 읽고 고른 반응<select name="reaction_id">${option(card.reactions||[])}</select></label><button class="btn btn-primary">반응 보내기</button></fieldset></form><p data-flow="reaction-saved"></p></section>
    <section class="plaza-step" data-flow="reflection-section"><h2>4. 오늘의 경험을 돌아봐요</h2><form data-flow="reflection"><fieldset data-fields="reflection">${questions.map((q,i)=>`<label>${q}<select data-answer-help="${i}"><option value="">직접 적기</option>${(card.reflection_options?.[i]||[]).map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select><textarea aria-label="${q}" name="answer${i}" rows="2" maxlength="220" required>${esc(a.reflection?.answers[i]||'')}</textarea></label>`).join('')}<button class="btn btn-primary">돌아보기 저장하기</button></fieldset></form><p data-flow="reflection-saved"></p>
      <button type="button" class="btn btn-ghost" data-flow="preview">최종 기록 확인하기</button><p class="plaza-help" data-flow="finish-help">확인할 기록을 만들면 활동 내용이 고정됩니다. 저장할 내용을 먼저 살펴보세요.</p><div data-flow="record-preview"></div><button type="button" class="btn btn-primary" data-flow="final" hidden>확인한 진로기록 저장하기</button><p data-flow="receipt" role="status"></p></section>`;
  function setSection(key) {
    for(const id of ['plan-section','actual-section','exchange-section','reflection-section'])$(id).hidden=id!==key;
    root.querySelectorAll('[data-jump]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.jump===key)));
  }
  root.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{setSection(b.dataset.jump);$(b.dataset.jump).scrollIntoView({behavior:'smooth',block:'start'});});
  root.querySelectorAll('form').forEach(form=>form.addEventListener('input',()=>{dirty.add(form.dataset.flow);changed();status('message','수정한 내용은 아직 저장되지 않았습니다. 해당 활동의 저장 버튼을 눌러 주세요.');}));
  $('ideas').onsubmit=e=>{e.preventDefault();const form=new FormData(e.target);void action('ideas','POST','/ai',{kind:'ideas',customer_id:form.get('customer_id'),material_ids:form.getAll('material_ids')});};
  $('plan').onsubmit=e=>{e.preventDefault();void action('plan','PUT','/draft',{...values('plan'),version:state.draft.version});};
  $('actual').onsubmit=e=>{e.preventDefault();void action('actual','PUT','/activity',{...values('actual'),kind:'actual',version:state.activity.version});};
  const medium=()=>state.room.stage3?{medium:$('paper-confirm').checked?'paper-confirmed':'online',confirm:$('paper-confirm').checked}:{};
  $('request').onsubmit=e=>{e.preventDefault();void action('request','POST','/message',{...values('request'),kind:'request',visit_id:state.exchange.outgoing?.id,...medium()});};
  $('reply-ai').onclick=()=>void action('reply-ai','POST','/ai',{kind:'reply',visit_id:state.exchange.incoming?.id});
  $('reply').onsubmit=e=>{e.preventDefault();void action('reply','POST','/message',{...values('reply'),kind:'reply',visit_id:state.exchange.incoming?.id,...medium()});};
  $('reaction').onsubmit=e=>{e.preventDefault();void action('reaction','POST','/message',{...values('reaction'),kind:'reaction',visit_id:state.exchange.outgoing?.id,...medium()});};
  $('reflection').onsubmit=e=>{e.preventDefault();const v=values('reflection');void action('reflection','PUT','/activity',{kind:'reflection',version:state.activity.version,answers:questions.map((_,i)=>v[`answer${i}`])});};
  $('preview').onclick=()=>{if(dirty.size||[...pending.keys()].some(k=>k!=='preview')){status('message','수정 중인 내용을 먼저 저장하고 확인해 주세요.');return;}void action('preview','POST',state.privacy?.record_choice==='no-record'?'/finish':'/record-preview',{});};
  $('final').onclick=()=>void action('final','POST','/record',{attempt_id:state.receipt.attempt_id,digest:state.receipt.digest});
  if($('withdraw-photo'))$('withdraw-photo').onclick=()=>{if(!confirm('사진 조회와 새 촬영을 막고 저장된 작품 사진 삭제를 요청할까요? 활동은 계속할 수 있습니다.'))return;void action('withdraw-photo','POST','/photo-choice',{photo_allowed:false,version:state.privacy.privacy_version});};
  $('reply-help').onchange=e=>{const option=card.reply_options.find(o=>o.id===e.target.value);if(option){$('reply').elements.text.value=option.text;dirty.add('reply');changed();}};
  $('actual-help').onchange=e=>{if(e.target.value){$('actual').elements.note.value=e.target.value;dirty.add('actual');changed();}};
  root.querySelectorAll('[data-answer-help]').forEach(select=>select.onchange=()=>{if(select.value){$('reflection').elements[`answer${select.dataset.answerHelp}`].value=select.value;dirty.add('reflection');changed();}});
  function lock() {
    const phase=state.room.state,frozen=!!state.receipt||!!state.privacy?.activity_completed_at,ex=state.exchange;
    const allowed={ideas:phase==='planning'&&state.ai.ideas?.status!=='ready',plan:phase==='planning'&&state.ai.ideas?.status==='ready',actual:['returning','exchange','reflection'].includes(phase),
      request:['exchange','reflection'].includes(phase)&&ex.outgoing&&!ex.outgoing.request,reply:['exchange','reflection'].includes(phase)&&state.ai.reply?.status==='ready'&&!ex.incoming?.reply,
      reaction:['exchange','reflection'].includes(phase)&&ex.outgoing?.reply&&!ex.outgoing.reaction,reflection:phase==='reflection'};
    root.querySelectorAll('[data-fields]').forEach(field=>field.disabled=busy||frozen||!allowed[field.dataset.fields]);
    root.querySelectorAll('form input,form textarea,form select').forEach(el=>el.disabled=false);
    if(state.ai.ideas)$('ideas').querySelectorAll('input,select').forEach(el=>el.disabled=true);
    // Uncertain writes must be retried with the same frozen payload, not overwritten by new edits.
    for(const [key] of pending){const form=$(key);if(form?.tagName==='FORM'){form.querySelectorAll('input,textarea,select').forEach(el=>el.disabled=true);}}
    $('reply-ai').disabled=busy||frozen||!['exchange','reflection'].includes(phase)||!ex.incoming?.request||state.ai.reply?.status==='ready';
    $('preview').disabled=busy||phase!=='reflection'||frozen;
    $('final').disabled=busy||!state.receipt||state.receipt.saved;
    if($('withdraw-photo'))$('withdraw-photo').disabled=busy||(!state.privacy.photo_allowed&&state.privacy.photo_purge?.status!=='retry');
  }
  function showStore(id,scroll=true) {
    const s=stores.find(s=>s.id===id);if(!s){status('message','가게 소개를 준비하고 있어요. 잠시 뒤 확인해 주세요.');return;}
    $('store-detail').hidden=false;$('store-detail').innerHTML=`<h3>${esc(s.name)}</h3><p>${esc(s.artwork_name)}</p>${s.photo_url?`<img src="${esc(s.photo_url)}" alt="${esc(s.artwork_name)} 작품 사진">`:'<div class="plaza-concept" aria-label="구상 전시"><span>구상 전시</span><strong>작품 사진 준비 중</strong></div>'}<p>${esc(s.introduction)}</p>`;
    $('store-detail').dataset.store=id;if(scroll)$('store-detail').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  $('my-store').onclick=()=>showStore(state.participant.store_public_id);
  $('store-list').onchange=e=>{if(e.target.value)showStore(e.target.value);};
  $('visit-store').onclick=()=>{if(state.exchange.outgoing?.substitute){status('message','이번 방문은 예시 가게와 대체 진행합니다. 요청을 골라 보내 주세요.');return;}showStore(state.exchange.outgoing?.store_public_id);};
  async function board() {
    const next=await request('GET',`/board?since=${boardVersion}`);if(disposed||next.unchanged||next.version<boardVersion)return;
    boardVersion=next.version;stores=next.stores;
    const parent=$('village'),existing=new Map([...parent.children].map(el=>[el.dataset.store,el]));
    for(const s of stores){let b=existing.get(s.id);if(!b){b=document.createElement('button');b.type='button';b.className='plaza-store';b.dataset.store=s.id;b.onclick=()=>showStore(s.id);parent.append(b);}
      const label=s.id===state.participant.store_public_id?'내 가게':s.id===state.exchange.outgoing?.store_public_id?'방문할 가게':'';
      b.title=s.name;b.setAttribute('aria-label',`${label?label+' · ':''}${s.name} · ${s.artwork_name} 소개 보기`);
      const html=`<strong class="plaza-store-name">${esc(s.name)}</strong><span class="plaza-store-artwork">${s.photo_url?`<img src="${esc(s.photo_url)}" alt="">`:'구상 전시'}</span><small>${label||'소개 보기'}</small>`;
      if(b.innerHTML!==html)b.innerHTML=html;existing.delete(s.id);}
    existing.forEach(el=>el.remove());
    const previous=$('store-list').value;$('store-list').innerHTML='<option value="">가게 선택</option>'+option(stores.map(s=>({id:s.id,text:s.name})),previous);
    if($('store-detail').dataset.store)showStore($('store-detail').dataset.store,false);
  }
  function update(next) {
    if(disposed||next.room.version<state.room.version)return;
    state=next;status('phase',label(state.room.state));
    if(state.privacy){
      const p=state.privacy,noRecord=p.record_choice==='no-record';
      status('privacy-status',`${noRecord?'진로기록 없이 참여':'마지막에 확인한 진로기록 남기기'} · ${p.photo_allowed?'작품 사진 전시 허용':'사진 없이 참여'}`);
      status('photo-purge',p.photo_purge?(p.photo_purge.status==='verified'?'광장 사진 파일의 삭제를 확인했습니다. 백업·내보내기는 별도 확인 대상입니다.':'사진 조회는 중지되었습니다. 파일 삭제 확인이 필요합니다. 같은 버튼으로 다시 확인해 주세요.'):'');
      status('preview',noRecord?'진로기록 없이 활동 완료하기':'최종 기록 확인하기');
      status('finish-help',noRecord?'활동을 완료하면 내용을 고정합니다. 진로기록용 학생 번호와 최종 기록은 만들지 않습니다.':'확인할 기록을 만들면 활동 내용이 고정됩니다. 저장할 내용을 먼저 살펴보세요.');
      if(p.activity_completed_at)status('receipt','활동 완료 · 진로기록을 남기지 않았습니다.');
    }
    if(displayPhase!==state.room.state){displayPhase=state.room.state;setSection(({planning:'plan-section',paused:'plan-section',returning:'actual-section',exchange:'exchange-section',reflection:'reflection-section'})[displayPhase]||'reflection-section');}
    $('pause-note').hidden=state.room.state!=='paused';
    status('plan-saved',dirty.has('plan')?'수정한 구상은 저장 전입니다.':state.draft.saved_at?'구상 저장됨 · 서버에서 확인했습니다.':'구상 저장 전');
    status('actual-saved',dirty.has('actual')?'수정한 제작 결과는 저장 전입니다.':state.activity.actual?'제작 결과 저장됨':'제작 결과 확인 전');
    status('reflection-saved',dirty.has('reflection')?'수정한 돌아보기는 저장 전입니다.':state.activity.reflection?'돌아보기 저장됨':'돌아보기 저장 전');
    const idea=state.ai.ideas;if(idea?.status==='ready'&&!$('idea-list').dataset.ready){
      status('ai-source',`${sourceLabel(idea)} · 두 안에서 하나를 고르고 바꿔 보세요.`);
      $('idea-list').innerHTML=idea.output.ideas.map((v,i)=>`<article><h3>구상 ${i+1}</h3><p>${esc(card.combinations.find(c=>c.id===v.combination_id)?.title)}</p><p>${esc(card.introductions.find(c=>c.id===v.introduction_id)?.text)}</p></article>`).join('');
      $('idea-select').innerHTML=option(idea.output.ideas.map((v,i)=>({id:v.id,text:`구상 ${i+1}`})),state.draft.content.idea_id);
      const available=card.combinations.filter(c=>c.material_ids.every(id=>idea.selection.material_ids.includes(id)));
      $('plan').elements.combination_id.innerHTML=option(available,state.draft.content.combination_id);
      $('idea-list').dataset.ready='1';
    }
    const own=$('own-photo'),url=state.photo_url||'';
    if(own.dataset.url!==url){own.dataset.url=url;own.innerHTML=url?`<img src="${esc(url)}" alt="내 작품 사진"><p>작품 사진 · 서버 저장 완료</p>`:'<div class="plaza-concept"><span>구상 전시</span><strong>작품 사진 준비 중</strong></div>';}
    const ex=state.exchange,requestText=m=>card.requests?.find(r=>r.id===m?.request_id)?.text;
    status('assignment',ex.outgoing?(ex.outgoing.substitute||ex.incoming?.substitute)?`일부 교류를 예시로 대체합니다. 또래 교류 완료로 기록되지 않습니다.${ex.outgoing.reason||ex.incoming?.reason?' 사유: '+(ex.outgoing.reason||ex.incoming.reason):''}`:'방문할 가게가 배정됐어요. 위에서 방문할 가게를 열어 소개를 읽어 보세요.':'선생님이 실제 참여자를 확인하고 광장을 열면 방문할 가게가 정해져요.');
    status('sent-request',ex.outgoing?.request?`보낸 요청 · ${requestText(ex.outgoing.request)}`:'');
    status('incoming-request',ex.incoming?.request?`${ex.incoming.request.source==='example'?'예시 손님 · ':''}${requestText(ex.incoming.request)}`:'아직 도착한 요청이 없습니다.');
    const reply=state.ai.reply;if(reply?.status==='ready')status('reply-draft',`${sourceLabel(reply)} 답장 초안 · ${card.reply_options.find(r=>r.id===reply.output.reply_id)?.text}`);
    status('reply-saved',ex.incoming?.reply?'내 답장 · 서버 저장 완료':'');
    status('received-reply',ex.outgoing?.reply?`${ex.outgoing.reply.source==='example'?'예시 답장 · ':''}${ex.outgoing.reply.text}`:'아직 답장을 기다리고 있어요.');
    status('reaction-saved',ex.outgoing?.reaction?'내 반응 · 서버 저장 완료':'');
    if(state.receipt){const r=state.receipt;if($('record-preview').dataset.attempt!==r.attempt_id){$('record-preview').dataset.attempt=r.attempt_id;$('record-preview').innerHTML=['process','artifact','reflection'].map((k,i)=>`<h3>${['활동 과정','결과물','돌아보기'][i]}</h3><p class="plaza-preserve">${esc(r.snapshot[k])}</p>`).join('');}
      $('final').hidden=r.saved;status('receipt',r.saved?'진로기록 · 서버 저장 완료. 오늘의 활동을 마쳤어요.':'확인한 내용이 고정됐습니다. 저장 버튼을 눌러 마쳐 주세요.');}
    lock();
  }
  update(data);
  return {update,async poll(){await board();},destroy(){disposed=true;state=null;stores=[];pending.clear();dirty.clear();}};
}
