/* Native MoaLab screens. No uploaded HTML, localStorage, or student identity in URLs. */
import {createPlazaStudent} from './plaza-student.js';
import {createPlazaRecovery} from './plaza-recovery.js';
export async function mountPlaza({ roomId, teacher, api, shell, esc }) {
  let disposed = false, terminated = false, busy = false, dirty = false, uncertain = null, timer, stream;
  let state, participants = [], selected = 0, studentFlow, recovery;
  const queue = [];
  const moveBytes = new Map();
  const base = `/api/plaza/rooms/${roomId}`;
  const request = (method, suffix, body) => api(method, base + suffix, body);
  shell(teacher ? '광장 수업 진행' : '우리 반 광장', '<p class="plaza" id="plaza-connection" role="status" hidden>접속을 확인하고 있습니다. 연결이 돌아오면 쓰던 화면으로 돌아갑니다. 인터넷이 끊기면 선생님과 종이 활동을 이어가세요. 아직 확인하지 못한 내용은 서버 저장 전입니다. 이 화면을 닫으면 전송하지 못한 글과 사진이 사라질 수 있습니다.</p><main class="plaza" id="plaza-root">접속을 확인하고 있습니다.</main>');
  const root = document.getElementById('plaza-root');
  const connection = document.getElementById('plaza-connection');
  const $ = name => root.querySelector(`[data-plaza="${name}"]`);
  const stateLabel = value => ({ planning: '구상하기', paused: '제작 중 · 잠시 멈춤', returning:'개장 준비',exchange:'광장 교류',reflection:'돌아보기와 저장 확인',closed: '수업 종료' }[value]);
  function message(text) { if ($('message')) $('message').textContent = text; }
  function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null; }
  function stopPresenting() { if(document.fullscreenElement&&root.contains(document.fullscreenElement))void document.exitFullscreen?.().catch(()=>{}); }
  function fatal(error) {
    if (disposed) return;
    terminated = true; recovery?.destroy(); recovery=null; studentFlow?.destroy(); studentFlow=null; stopPresenting();stopCamera(); queue.length = 0; moveBytes.clear(); uncertain = null; state = null; participants = []; dirty = false; clearInterval(timer);
    root.hidden = false; connection.hidden = true;
    root.innerHTML = `<h1>접속을 다시 확인해 주세요</h1><p>${esc(error.message)}</p><a class="btn btn-primary" href="#/decks">수업 자료로 돌아가기</a>`;
  }
  function header(room, title) {
    return `<div class="plaza-heading"><p class="plaza-kicker">모아킷 · 모아랩</p><h1>${esc(title)}</h1><p class="plaza-phase" data-plaza="phase">${esc(stateLabel(room.state))}</p></div>`;
  }
  function photo(url) {
    const el = $('photo');
    if (!el) return;
    if (url) {
      if (el.dataset.url !== url) { el.innerHTML = `<img src="${esc(url)}" alt="내 작품 사진"><p>작품 사진 · 서버 저장 완료</p>`; el.dataset.url = url; }
    } else { el.innerHTML = '<div class="plaza-photo-empty">작품 사진 준비 중</div><p>만들 작품을 떠올리며 구상을 적어 보세요.</p>'; delete el.dataset.url; }
  }
  function updateStudent(data) {
    if (disposed || !$('form')) return;
    state.room = data.room;
    $('phase').textContent = stateLabel(data.room.state);
    const paused = data.room.state !== 'planning';
    $('fields').disabled = paused || busy;
    $('save').disabled = paused || busy;
    $('pause-note').hidden = !paused;
    if (!dirty && !busy && data.draft.version > state.draft.version) {
      message('다른 화면에서 저장된 구상이 있습니다. 쓴 글을 확인한 뒤 다시 입장해 주세요.');
    }
    photo(data.photo_url);
  }
  function formContent() {
    return Object.fromEntries(new FormData($('form')).entries());
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    busy = true; $('save').disabled = true;
    const content = formContent();
    const serialized = uncertain?.serialized || JSON.stringify(content);
    uncertain ||= { serialized, body: { ...content, version: state.draft.version, attempt_id: crypto.randomUUID() } };
    message('구상을 저장하고 있습니다.');
    try {
      const saved = await request('PUT', '/draft', uncertain.body);
      if (disposed) return;
      state.draft.version = saved.version; state.draft.saved_at = saved.saved_at;
      dirty = JSON.stringify(formContent()) !== serialized;
      uncertain = null; message(dirty ? '이전 구상은 저장됐습니다. 수정한 내용도 저장해 주세요.' : '구상 저장됨 · 서버에서 확인했습니다.');
    } catch (error) {
      if (disposed) return;
      if (error.status === 403 || !document.contains(root)) { fatal(error); return; }
      if (error.status === 409 || error.status === 400) uncertain = null;
      message(error.status === 409 ? error.message : '저장 확인 필요 · 같은 내용으로 다시 저장해 주세요.');
    } finally { busy = false; if (!disposed && $('save')) $('save').disabled = state.room.state !== 'planning'; }
  }
  function renderStudent(data) {
    state = data;
    if(data.room.stage2) {
      studentFlow=createPlazaStudent({root,data,request,esc,onDirty:value=>{dirty=value;},onFatal:fatal});
      return;
    }
    const d = data.draft.content;
    root.innerHTML = `${header(data.room, '내 작품을 구상해요')}<div class="plaza-layout">
      <section><p class="plaza-seat">내 자리 ${esc(data.participant.seat_order)}번</p>
      <p>사람마다 향을 받아들이는 정도가 달라요. 어떤 손님을 배려할까요?</p>
      <form data-plaza="form"><fieldset data-plaza="fields"><legend class="sr-only">작품 구상</legend>
      <label>내 손님<select name="customer_id" required>${data.room.customers.map(c => `<option value="${esc(c.id)}" ${d.customer_id === c.id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></label>
      <label>어떤 작품을 만들고 싶나요?<textarea name="plan" maxlength="500" rows="4" required placeholder="손님에게 어떻게 소개할지 적어 보세요.">${esc(d.plan || '')}</textarea></label>
      <div class="plaza-name-fields"><label>작품 이름<input name="artwork_name" maxlength="40" value="${esc(d.artwork_name || '')}" required></label>
      <label>가게 이름<input name="store_name" maxlength="40" value="${esc(d.store_name || '')}" required></label></div></fieldset>
      <p class="plaza-help">이름·전화번호 같은 개인정보는 적지 마세요.</p><button class="btn btn-primary" data-plaza="save">구상 저장하기</button>
      <p role="status" data-plaza="message">${data.draft.saved_at ? '구상 저장됨 · 서버에서 확인했습니다.' : '구상을 적고 저장해 주세요.'}</p></form>
      <p class="plaza-pause-note" data-plaza="pause-note" hidden>제작하러 가도 구상은 남아 있어요. 선생님이 다시 열면 이어서 할 수 있어요.</p>
      </section><aside class="plaza-photo" data-plaza="photo"></aside></div>`;
    $('form').addEventListener('submit', save);
    $('form').addEventListener('input', () => { dirty = true; message(uncertain ? '저장 확인 필요 · 앞서 보낸 내용을 먼저 확인해 주세요.' : '수정한 내용은 아직 저장되지 않았습니다.'); });
    updateStudent(data);
  }
  async function entry() {
    const data = await request('GET', '/entry');
    if (disposed) return;
    root.innerHTML = `${header(data.room, '내 자리로 들어가요')}<div class="plaza-entry">
      <p>이어 하던 활동인지, 처음 시작하는 활동인지 확인해 주세요.</p>
      ${data.can_resume ? '<button class="btn btn-primary" data-plaza="resume">내 구상 이어가기</button>' : ''}
      ${data.room.stage4?`<p class="plaza-pause-note">가짜 참여자만 사용하는 시험 화면입니다. 실제 학생의 사진·활동·기록은 수집하지 않습니다.</p><p>진로기록을 남기지 않아도 구상·교류·돌아보기를 모두 할 수 있습니다. 선택에 따라 진로기록용 학생 번호도 만들지 않습니다. 수업 중 활동은 임시로 처리하며, 사진 선택은 별도입니다.</p><p>${data.notice.policy?`수업 종료 또는 이용 만료부터 사진·임시 파일 ${data.notice.policy.photo_hours}시간, 활동 초안 ${data.notice.policy.activity_hours}시간, 운영 이력 ${data.notice.policy.audit_hours}시간 후 파기 대상입니다. 관리자가 파기 결과를 확인합니다.`:'관리자의 시험 보관 기간 등록을 기다리고 있습니다.'} 최종 진로기록·백업·내보내기의 운영 보관 정책은 확정 전입니다.</p>`:''}
      <form data-plaza="entry">${data.room.stage4?`<fieldset><legend>이번 활동의 진로기록</legend><label><input type="radio" name="record_choice" value="record" required> 마지막에 내가 확인한 진로기록 남기기</label><label><input type="radio" name="record_choice" value="no-record" required> 진로기록 없이 활동하기</label></fieldset><fieldset><legend>작품 사진</legend><label><input type="radio" name="photo_allowed" value="yes" required> 작품만 촬영하여 이번 수업에 전시하기</label><label><input type="radio" name="photo_allowed" value="no" required> 사진 없이 참여하기</label></fieldset><label><input type="checkbox" name="notice" required> 시험 안내와 임시 보관 기간을 확인했습니다.</label>`:''}<label>자리 번호<input type="number" name="seat_order" min="1" max="${data.room.seat_count}" required inputmode="numeric"></label>
      <button class="btn ${data.can_resume ? 'btn-ghost' : 'btn-primary'}" ${data.room.state !== 'planning'||(data.room.stage4&&!data.notice.policy) ? 'disabled' : ''}>${data.can_resume ? '새 학생으로 입장' : '처음 입장하기'}</button></form>
      ${data.room.stage3?'<form data-plaza="claim"><label>새 기기 연결값<input name="code" autocomplete="off" spellcheck="false" maxlength="40" required placeholder="강사가 보여 준 연결값"></label><button class="btn btn-ghost">이 기기에서 이어가기</button></form>':''}<p data-plaza="message" role="status"></p></div>`;
    let entryPending;
    async function enter(body,suffix='/enter') {
      if (busy) return; busy = true;
      entryPending||={body:{...body,attempt_id:crypto.randomUUID()},suffix};
      root.querySelectorAll('input').forEach(el=>el.disabled=true);
      try { const result = await request('POST', entryPending.suffix, entryPending.body); entryPending=null;if (!disposed && !terminated) renderStudent(result); }
      catch (error) { if(error.status&&error.status<500)entryPending=null;message(error.status&&error.status<500?error.message:'입장 확인 필요 · 같은 버튼으로 다시 확인해 주세요.');if(!entryPending)root.querySelectorAll('input').forEach(el=>el.disabled=false); }
      finally { busy = false; if (state?.room && $('form')) updateStudent(state); }
    }
    if($('claim'))$('claim').onsubmit=e=>{e.preventDefault();void enter({code:new FormData(e.target).get('code')},'/claim');};
    if ($('resume')) $('resume').onclick = () => enter({ mode: 'resume' });
    $('entry').onsubmit = event => {
      event.preventDefault();
      if (data.can_resume && !confirm('이전 학생의 접속을 끝내고 새 학생으로 입장할까요?')) return;
      const form=new FormData(event.target);
      enter({ mode: 'new', seat_order: Number(form.get('seat_order')), replace_current: data.can_resume,...(data.room.stage4?{record_choice:form.get('record_choice'),photo_allowed:form.get('photo_allowed')==='yes',notice_version:form.get('notice')?data.notice.version:null}: {}) });
    };
  }
  function currentTarget() { return participants[selected] ? { ...participants[selected] } : null; }
  function pendingPhotos(){return new Set([...(state?.photos||[]).filter(p=>p.status!=='stored'&&!p.invalidated_at).map(p=>p.id),...queue.filter(q=>q.data).map(q=>q.id)]).size;}
  function selectTarget(index) {
    if (!participants.length || !$('target')) return;
    selected = Math.max(0, Math.min(participants.length - 1, index));
    const p = currentTarget(); $('target').value = p.id;
    $('target-title').textContent = `${p.seat_order}번 · ${p.store_name || '가게 이름 준비 중'}${p.photo_allowed===false?' · 사진 없이 참여':''}`;
    for(const k of ['file','capture'])if($(k))$(k).disabled=p.photo_allowed===false||state?.room.state==='closed'||(k==='capture'&&!stream);
  }
  function renderQueue(serverPhotos = []) {
    if (!$('queue')) return;
    for(const item of queue){if(participants.find(p=>p.id===item.target.id)?.photo_allowed===false){item.status='사진 없이 참여 · 전송 취소';item.failed=false;item.data=null;moveBytes.delete(item.id);continue;}const known=serverPhotos.find(p=>p.id===item.id);if(known?.invalidated_at){item.status='사진 대상 변경됨';item.failed=false;item.data=null;}else if(known?.status==='stored'){item.status='서버 저장 완료';item.failed=false;item.data=null;}}
    const rows = queue.map(item => `<li>${esc(item.target.seat_order)}번 · ${esc(item.target.store_name || '가게')} <span>${esc(item.status)}</span>${item.failed ? `<button type="button" class="btn btn-ghost" data-retry="${item.id}">다시 보내기</button>` : ''}</li>`);
    const localIds = new Set(queue.map(q => q.id));
    for (const p of serverPhotos.filter(p => p.status !== 'stored' && !p.invalidated_at && !localIds.has(p.id))) {
      const target = participants.find(t => t.id === p.participant_id);
      rows.push(`<li>${esc(target?.seat_order || '')}번 · 재촬영 필요 <span>기기에 남은 사진이 없습니다.</span></li>`);
    }
    $('queue').innerHTML = rows.join('') || '<li>아직 촬영한 사진이 없습니다.</li>';
    $('queue').querySelectorAll('[data-retry]').forEach(b => b.onclick = () => upload(queue.find(q => q.id === b.dataset.retry)));
  }
  async function upload(item) {
    if (!item || item.sending || disposed) return;
    if(participants.find(p=>p.id===item.target.id)?.photo_allowed===false){item.data=null;renderQueue(state.photos);return;}
    item.sending = true; item.failed = false; item.status = '전송 중'; renderQueue(state.photos);
    try {
      await request('POST','/photos', { capture_id: item.id, participant_id: item.target.id, target_version: item.target.target_version });
      await request('PUT', `/photos/${item.id}`, { data_url: item.data,target_version:item.target.target_version });
      item.status = '서버 저장 완료'; item.data = null;
    } catch (error) { item.failed = true; item.status = error.status && error.status < 500 ? '다시 보내기 전 확인 필요' : '저장 확인 필요'; message(error.message); }
    finally { item.sending = false; if (!disposed) { renderQueue(state.photos); await revalidate(); } }
  }
  async function capture(source, target) {
    if (!target || disposed) return;
    if(target.photo_allowed===false){message('이 학생은 사진 없이 참여합니다. 다음 가게를 선택해 주세요.');return;}
    let bitmap;
    try {
      bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
      const width = bitmap.width || bitmap.videoWidth, height = bitmap.height || bitmap.videoHeight;
      if (!width || !height) throw new Error('카메라가 준비된 뒤 다시 찍어 주세요.');
      const canvas = document.createElement('canvas');
      const ratio = Math.min(1,1280 / Math.max(width,height));
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      let data = canvas.toDataURL('image/jpeg',0.75);
      if (data.length > 900023) data = canvas.toDataURL('image/jpeg',0.45);
      if (data.length > 900023) throw new Error('사진이 너무 큽니다. 조금 더 단순한 배경에서 찍어 주세요.');
      const item = { id: crypto.randomUUID(), target, data, status: '촬영됨', failed: false };
      queue.push(item); renderQueue(state.photos); selectTarget(selected + 1);
      void upload(item);
    } catch (error) { message(error.message); }
    finally { if (bitmap && bitmap !== source) bitmap.close?.(); }
  }
  function updateTeacher(data) {
    if (disposed || !$('target')) return;
    const previous = currentTarget()?.id;
    state = data; participants = data.participants;
    $('phase').textContent = stateLabel(data.room.state);
    $('incomplete').textContent = data.counts ? `참여 ${data.counts.present??participants.length}명 · 결석 ${data.counts.absent??0}명${data.room.source_activity?` · 기존 활동 확인 전 ${data.counts.source_activity_missing}명`:''} · 구상 미완료 ${data.counts.plan_missing}명 · 제작 확인 전 ${data.counts.actual_missing}명 · 교류 미완료 ${data.counts.exchange_missing}명 · 기록 저장 ${data.counts.record_saved}명 / 미완료 ${data.counts.record_missing}명 ${data.room.stage4?` · 기록 없이 참여 ${data.counts.no_record}명 / 활동 완료 ${data.counts.activity_completed}명`:''} · 또래 교류 완료 ${data.counts.peer_complete}명 / 대체 완료 ${data.counts.substitute_complete}명` : `구상 미완료 ${data.incomplete}명 / 참여 ${participants.length}명`;
    $('target').innerHTML = participants.map(p => `<option value="${p.id}">${esc(p.seat_order)}번 · ${esc(p.store_name || '가게 이름 준비 중')}${p.photo_allowed===false?' · 사진 없이 참여':''}</option>`).join('');
    const idx = participants.findIndex(p => p.id === previous); selectTarget(idx >= 0 ? idx : selected);
    $('roster').innerHTML = participants.map(p => {const progress=data.progress?.find(r=>r.id===p.id);return `<tr><td>${esc(p.seat_order)}번${p.attendance==='absent'?' · 결석':''}</td><td>${esc(p.store_name || '이름 준비 중')}</td><td>${p.saved_at ? '구상 저장됨' : '구상 미완료'}${data.room.source_activity&&progress?`<br>기존 활동 영감 ${progress.source_activity?'확인됨':'확인 전'}`:''}${progress?`<br>제작 확인 ${progress.actual?'완료':'전'} · 요청 ${progress.request?'완료':'전'} · 답장 ${progress.reply?'완료':'전'} · 반응 ${progress.reaction?'완료':'전'} · 돌아보기 ${progress.reflection?'완료':'전'} · 기록 ${p.record_choice==='no-record'?'남기지 않음':progress.saved?'저장됨':'미완료'}`:''}</td><td>${p.photo_allowed===false?'사진 없이 참여':p.current_photo_id ? '서버 저장 완료' : '작품 사진 준비 중'}</td></tr>`;}).join('');
    const closed = data.room.state === 'closed';
    $('pause').disabled = closed; $('pause').textContent = data.room.state === 'paused' ? '구상 다시 열기' : '제작하러 가기';
    if(data.room.stage2) {
      const next={planning:['paused','제작하러 가기'],paused:['returning','작품 확인 열기'],returning:['exchange','광장 열기'],exchange:['reflection','돌아보기 열기']}[data.room.state];
      $('pause').disabled=!next;$('pause').textContent=next?.[1]||'돌아보기와 저장 확인 중';$('pause').dataset.next=next?.[0]||'';
    }
    $('close').disabled = closed; $('camera').disabled = closed || !participants.length; $('file').disabled = closed || !participants.length||currentTarget()?.photo_allowed===false; $('capture').disabled = closed || !stream || !participants.length||currentTarget()?.photo_allowed===false;
    if (closed) stopCamera();
    recovery?.update(data);
    renderQueue(data.photos);
  }
  async function teacherScreen() {
    const data = await request('GET','/teacher');
    if (disposed) return;
    state = data;
    root.innerHTML = `${header(data.room, '구상에서 작품까지')}<p>자리 순서대로 작품만 촬영해 주세요. 얼굴과 이름표는 사진에 담지 않습니다.</p>
      <div class="plaza-controls"><strong data-plaza="incomplete"></strong><button class="btn btn-primary" data-plaza="pause">제작하러 가기</button><button class="btn btn-ghost" data-plaza="close">수업 종료</button>${data.room.stage2?'<button class="btn btn-ghost" data-plaza="slides-open">강사용 슬라이드</button>':''}</div>
      ${data.room.stage2?'<p class="plaza-help">1교시: 직업 소개 10분 → 기존 활동·작품 구상 20분 → 제작 안내 15분 / 2교시: 제작 / 3교시: 마무리·촬영 20분 → 광장 활동 25분</p><section class="plaza-presenter" data-plaza="slides-panel" hidden></section>':''}
      <div class="plaza-layout"><section class="plaza-camera"><h2 data-plaza="target-title">촬영할 가게</h2><label>가게 선택<select data-plaza="target"></select></label>
      <video data-plaza="video" autoplay muted playsinline aria-label="작품 촬영 미리보기"></video>
      <div class="plaza-controls"><button class="btn btn-ghost" data-plaza="camera">카메라 켜기</button><button class="btn btn-primary" data-plaza="capture" disabled>찍고 다음 자리</button><button class="btn btn-ghost" data-plaza="skip">건너뛰기</button><button class="btn btn-ghost" data-plaza="back">이전 자리 · 다시 찍기</button></div>
      <label class="plaza-file">사진 선택 또는 기기 카메라<input type="file" accept="image/*" capture="environment" data-plaza="file"></label>
      <p class="plaza-help">촬영 후 다음 자리로 넘어갑니다. 서버 저장 완료를 꼭 확인해 주세요.</p><p data-plaza="message" role="status"></p></section>
      <section><h2>사진 저장 상태</h2><ul class="plaza-queue" data-plaza="queue"></ul><p class="plaza-help">전송하지 못한 사진은 이 화면을 닫으면 사라집니다. 먼저 다시 보내 주세요.</p></section></div>
      ${data.room.stage3?'<section class="plaza-step" data-plaza="recovery"></section>':''}<div class="plaza-table-wrap"><table><thead><tr><th>자리</th><th>가게</th><th>구상</th><th>사진</th></tr></thead><tbody data-plaza="roster"></tbody></table></div>`;
    if(data.room.stage3)recovery=createPlazaRecovery({root:$('recovery'),request,esc,onChanged:revalidate,onFatal:fatal,
      onMoveStart:body=>{const bytes=queue.find(q=>q.id===body.capture_id)?.data;if(bytes)moveBytes.set(body.capture_id,bytes);},onMoveCancelled:body=>moveBytes.delete(body.capture_id),onMove:async(result,body)=>{
      const bytes=moveBytes.get(body.capture_id);moveBytes.delete(body.capture_id);
      if(!result.needs_upload)return;const old=queue.find(q=>q.id===body.capture_id),target=participants.find(p=>p.id===result.participant_id);
      if(!bytes||!target)return;const item={id:result.id,target:{...target,target_version:result.target_version},data:bytes,status:'촬영됨',failed:false};if(old){old.data=null;old.failed=false;old.status='사진 대상 변경됨';}queue.push(item);void upload(item);
    }});
    $('target').onchange = () => selectTarget(participants.findIndex(p => p.id === $('target').value));
    $('skip').onclick = () => selectTarget(selected + 1); $('back').onclick = () => selectTarget(selected - 1);
    $('camera').onclick = async () => {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (disposed) { stopCamera(); return; } $('video').srcObject = stream; $('capture').disabled = !participants.length||currentTarget()?.photo_allowed===false;
      } catch { message('카메라를 열지 못했습니다. 아래 사진 선택을 이용하거나 기기 권한을 확인해 주세요.'); }
    };
    $('capture').onclick = () => { const target = currentTarget(); void capture($('video'), target); };
    let fileTarget;
    $('file').onclick = () => { fileTarget = currentTarget(); };
    $('file').onchange = e => { const file = e.target.files[0]; const target = fileTarget || currentTarget(); e.target.value = ''; if (file) void capture(file,target); };
    $('pause').onclick = async () => {
      if(state.room.stage2) {
        const next=$('pause').dataset.next;
        if(!confirm(`구상 미완료 ${state.counts.plan_missing}명, 제작 확인 전 ${state.counts.actual_missing}명, 교류 미완료 ${state.counts.exchange_missing}명입니다. ${next==='exchange'?`현재 참여 ${participants.filter(p=>p.attendance!=='absent').length}명의 방문을 한 번만 배정하여 광장을 열까요?`:'다음 수업 단계로 갈까요? 미완료 활동은 그대로 남습니다.'}`))return;
        try{await request('POST','/state',{state:next,version:state.room.version,participant_ids:participants.filter(p=>p.attendance!=='absent').map(p=>p.id)});await revalidate();}catch(error){message(error.message);}return;
      }
      if (!confirm(`구상 미완료 ${state.incomplete}명입니다. ${state.room.state === 'paused' ? '구상을 다시 열까요?' : '제작하러 갈까요? 미완료 구상은 그대로 남습니다.'}`)) return;
      try { await request('POST','/state',{ state: state.room.state === 'paused' ? 'planning' : 'paused', version: state.room.version }); await revalidate(); }
      catch (error) { message(error.message); }
    };
    $('close').onclick = async () => {
      if (!confirm(`구상 미완료 ${state.incomplete}명${state.counts?`, 기록 미완료 ${state.counts.record_missing}명`:''}, 사진 저장 확인 필요 ${pendingPhotos()}건입니다. 학생 접속을 끝낼까요? 종료 후 다시 열 수 없습니다.`)) return;
      const reason=state.counts?.record_missing?prompt('기록 미완료 상태로 종료하는 사유를 적어 주세요.'):undefined;
      if(state.counts?.record_missing&&!reason)return;
      try { await request('POST','/state',{ state: 'closed', version: state.room.version,reason }); await revalidate(); }
      catch (error) { message(error.message); }
    };
    if($('slides-open'))$('slides-open').onclick=async()=>{
      const panel=$('slides-panel');panel.hidden=!panel.hidden;if(panel.hidden)return;
      try {
        let {material}=await request('GET','/slides');let index=0;
        const draw=()=>{
          if(!material){panel.innerHTML='<h2>비공개 강사 교안 등록</h2><p>자료를 만든 강사가 교안 파일을 등록하면 담당 강사만 이 화면에서 발표할 수 있습니다.</p><label>교안 파일 선택<input type="file" accept="application/json,.json" data-slide-upload></label>';
            panel.querySelector('input').onchange=async e=>{try{const file=e.target.files[0];if(!file||file.size>160000)throw new Error('교안 파일 크기를 확인해 주세요.');material=(await request('PUT','/slides',JSON.parse(await file.text()))).material;draw();}catch(error){message(error.message);}};return;}
          const slide=material.slides[index];panel.innerHTML=`<p>${esc(material.title)} · ${index+1} / ${material.slides.length} · 약 ${slide.minutes}분</p><div class="plaza-slide"><h2>${esc(slide.title)}</h2><ul>${slide.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></div><details><summary>발표자 설명</summary><p class="plaza-preserve">${esc(slide.notes)}</p></details><div class="plaza-controls"><button class="btn btn-ghost" data-prev ${index===0?'disabled':''}>이전</button><button class="btn btn-primary" data-next ${index===material.slides.length-1?'disabled':''}>다음</button><button class="btn btn-ghost" data-full>발표 화면 크게 보기</button></div>`;
          panel.querySelector('[data-prev]').onclick=()=>{index--;draw();};panel.querySelector('[data-next]').onclick=()=>{index++;draw();};panel.querySelector('[data-full]').onclick=()=>panel.querySelector('.plaza-slide').requestFullscreen?.();
        };draw();
      }catch(error){message(error.message);panel.hidden=true;}
    };
    updateTeacher(data);
  }
  let validating = false, visibilityEpoch = 0;
  async function revalidate() {
    if (disposed || terminated || validating || document.hidden || navigator.onLine===false) return;
    validating = true;
    const epoch=visibilityEpoch;
    try {
      if (teacher) {const next=await request('GET','/teacher');if(epoch!==visibilityEpoch)return;updateTeacher(next);}
      else if(studentFlow){const next=await request('GET','/mine');if(epoch!==visibilityEpoch)return;studentFlow.update(next);await studentFlow.poll();}
      else if ($('form')) {const next=await request('GET','/mine');if(epoch!==visibilityEpoch)return;updateStudent(next);}
      else await request('GET','/entry');
      if (!disposed&&!terminated&&!document.hidden&&epoch===visibilityEpoch&&navigator.onLine!==false) { root.hidden = false; connection.hidden = true; }
    } catch (error) {
      if (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 410 || !document.contains(root)) fatal(error);
      else { root.hidden = true; connection.hidden = false; }
    } finally { validating = false;if(epoch!==visibilityEpoch&&!disposed&&!terminated&&!document.hidden&&navigator.onLine!==false)void revalidate(); }
  }
  function visibility() { visibilityEpoch++;recovery?.hideSecrets();stopPresenting();root.hidden = true; connection.hidden = false; if (document.hidden) stopCamera(); else void revalidate(); }
  function beforeUnload(event) { if (dirty || uncertain || recovery?.hasPending() || moveBytes.size || queue.some(q => q.data)) { event.preventDefault(); event.returnValue = ''; } }
  function destroy() {
    disposed = true; recovery?.destroy();recovery=null;studentFlow?.destroy();studentFlow=null;clearInterval(timer);stopPresenting();stopCamera(); queue.length = 0;moveBytes.clear(); uncertain = null; state = null; participants = [];
    root.replaceChildren(); connection.remove(); document.removeEventListener('visibilitychange',visibility); window.removeEventListener('beforeunload',beforeUnload); window.removeEventListener('pagehide',destroy);window.removeEventListener('offline',offline);window.removeEventListener('online',revalidate);
  }
  function offline(){visibilityEpoch++;recovery?.hideSecrets();stopPresenting();stopCamera();root.hidden=true;connection.hidden=false;}
  window.addEventListener('offline',offline);window.addEventListener('online',revalidate);
  document.addEventListener('visibilitychange',visibility); window.addEventListener('beforeunload',beforeUnload); window.addEventListener('pagehide',destroy);
  try { if (teacher) await teacherScreen(); else await entry(); }
  catch (error) { fatal(error); }
  if(document.hidden)visibility();
  if (!terminated) timer = setInterval(revalidate,3000);
  return { revalidate, destroy, hash: location.hash };
}
