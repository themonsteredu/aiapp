/* Administrator maintenance; never displays student activity text. */
export async function mountPlazaRetention({api,shell,esc}) {
  let disposed=false,busy=false,selected='',pending=null,preview=null,orphans=null;
  const data=await api('GET','/api/plaza/retention');
  shell('광장 보관·파기',`<main class="plaza" id="plaza-retention"><h1>광장 보관·파기</h1>
    <p class="plaza-pause-note">가짜 데이터의 로컬 시험 전용입니다. 실제 학생 수집과 운영 배포는 차단되어 있습니다.</p>
    <details><summary>실제 학생 수집 전 남은 조건</summary><ul>${data.gate.pending.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details>
    <p>기한이 지난 대상을 확인하고 직접 파기를 실행합니다. 이 화면은 자동 실행 예약이 아닙니다. 진로기록 원본과 백업·내보내기는 별도 파기 절차가 필요합니다.</p>
    <label>관리할 시험 수업<select data-retention="room"><option value="">수업 선택</option>${data.rooms.map(r=>`<option value="${r.id}">${esc(r.title)} · ${esc(r.state)}</option>`).join('')}</select></label>
    <p role="status" data-retention="message"></p><div data-retention="detail"></div>
    <section><h2>등록되지 않은 시험 사진 파일</h2><p>전용 시험 저장소의 무작위 사진 번호와 임시 파일만 확인합니다. 다른 이름의 파일은 지우지 않습니다.</p><button class="btn btn-ghost" data-retention="scan">고아 파일 목록 확인</button><div data-retention="orphans"></div></section></main>`);
  const root=document.getElementById('plaza-retention'),$=k=>root.querySelector(`[data-retention="${k}"]`);
  const message=t=>{if(!disposed)$('message').textContent=t;};
  const base=()=>`/api/plaza/rooms/${selected}/retention`;
  function lock(){root.querySelectorAll('button,input,select').forEach(el=>el.disabled=busy||!!pending);if(pending&&!busy&&$('retry'))$('retry').disabled=false;}
  function renderResult(result) {
    const items=result.items||[];
    message(`광장 파기 ${result.status==='verified'?'검증 완료':'재시도 필요'} · 파일 ${items.filter(i=>i.status==='verified').length}/${items.length}건 확인. 전체 시스템 파기 완료가 아닙니다.`);
  }
  async function mutate(path,body) {
    if(busy||disposed)return;
    pending||={path,body:{attempt_id:crypto.randomUUID(),...body}};busy=true;lock();
    try {
      const result=await api('POST',pending.path,pending.body);if(disposed)return;
      pending=null;if(result.status)renderResult(result);else message('시험 보관 기간을 등록했습니다.');
      if(selected)await load();
      orphans=null;$('orphans').innerHTML='';
    }catch(e){
      if(disposed)return;
      if(e.status&&e.status<500)pending=null;
      message(pending?'처리 확인 필요 · 같은 내용으로 다시 확인해 주세요.':e.message);
    }finally{busy=false;if(!disposed){if(pending){const b=document.createElement('button');b.className='btn btn-primary';b.dataset.retention='retry';b.textContent='같은 파기 요청 다시 확인';b.onclick=()=>void mutate(pending.path,pending.body);$('message').append(b);}lock();}}
  }
  function summary(p){return `<p>사진 파일 ${p.keys.length}개 · 활동 연결 ${p.counts.participants}명 · 이번 범위: ${esc(p.scopes.join(', ')||'기한 도래 대상 없음')}</p><ul>${Object.entries(p.due_at).map(([k,v])=>`<li>${esc(k)}: ${esc(v||'수업 종료 또는 이용 만료 전')}</li>`).join('')}</ul>`;}
  async function load() {
    const id=selected;if(!id)return;
    const result=await api('GET',base());if(disposed||id!==selected)return;
    preview=result.preview;
    $('detail').innerHTML=`<section><h2>시험 보관 기간</h2>${result.policy?`<p>종료·만료 시점 중 빠른 시점부터 사진·임시 파일 ${result.policy.photo_hours}시간, 활동 초안 ${result.policy.activity_hours}시간, 운영 이력 ${result.policy.audit_hours}시간입니다. 확정한 시험 기간은 바꿀 수 없습니다.</p>`:
      `<form data-retention="policy">${[['photo_hours','사진·이전 사진·임시 파일'],['activity_hours','활동 초안·교류·접수 사본'],['audit_hours','접속·운영 이력']].map(([name,title])=>`<label>${title} 보관 시간<input type="number" name="${name}" min="0" max="87600" required></label>`).join('')}<label><input type="checkbox" name="confirm" required> 가짜 데이터 시험 기간이며 운영 보관 정책이 아님을 확인했습니다.</label><button class="btn btn-primary">시험 기간 확정</button></form>`}</section>
      <section><h2>파기할 목록</h2><div data-retention="preview">${summary(preview)}</div><button class="btn btn-ghost" data-retention="refresh">기한·목록 다시 확인</button> <button class="btn btn-ghost" data-retention="restore">복원 후 삭제 목록 재적용 확인</button> <button class="btn btn-primary" data-retention="purge">확인한 범위 파기 실행</button><p>파일별 삭제와 실제 부재 확인을 거칩니다. 파기를 시작한 수업의 일반 조회는 차단됩니다.</p></section>
      <section><h2>파기 작업 이력</h2>${result.jobs.map(j=>`<p>${esc(j.created_at)} · ${esc(j.scopes.join(', '))} · ${j.status==='verified'?'광장 범위 검증 완료':'재시도 필요'} <button class="btn btn-ghost" data-job="${j.id}">파일 부재 재확인·재시도</button></p>`).join('')||'<p>아직 파기 작업이 없습니다.</p>'}</section>`;
    if($('policy'))$('policy').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);void mutate(base()+'/policy',{photo_hours:Number(f.get('photo_hours')),activity_hours:Number(f.get('activity_hours')),audit_hours:Number(f.get('audit_hours')),confirm_test_only:!!f.get('confirm')});};
    $('refresh').onclick=()=>void inspect(false);
    $('restore').onclick=()=>void inspect(true);
    $('purge').onclick=()=>{if(!preview?.scopes.length){message('아직 기한이 지난 파기 대상이 없습니다.');return;}if(confirm(`확인한 ${preview.scopes.join(', ')} 범위를 파기할까요? 삭제한 활동과 사진은 되돌릴 수 없습니다.`))void mutate(base()+'/purge',{digest:preview.digest,restore:preview.restore,confirm:true});};
    root.querySelectorAll('[data-job]').forEach(b=>b.onclick=()=>void mutate(base()+`/jobs/${b.dataset.job}/retry`,{}));
    lock();
  }
  async function inspect(restore){try{const id=selected,p=await api('GET',base()+`/preview${restore?'?restore=1':''}`);if(!disposed&&id===selected){preview=p;$('preview').innerHTML=summary(p);message(restore?'복원 재적용 목록을 확인했습니다. 파기 실행으로 적용해 주세요.':'현재 기한과 목록을 확인했습니다.');}}catch(e){message(e.message);}}
  $('room').onchange=async e=>{selected=e.target.value;preview=null;$('detail').innerHTML='';try{await load();}catch(e){message(e.message);}};
  $('scan').onclick=async()=>{try{orphans=await api('GET','/api/plaza/retention/orphans');if(disposed)return;$('orphans').innerHTML=`<p>등록되지 않은 사진 번호 ${orphans.keys.length}개 · 삭제하지 않을 다른 파일 ${orphans.unrecognized_count}개</p><button class="btn btn-primary" data-retention="delete-orphans">확인한 고아 파일 파기</button>`;$('delete-orphans').onclick=()=>{if(orphans.keys.length&&confirm(`확인한 고아 사진 ${orphans.keys.length}개를 파기할까요?`))void mutate('/api/plaza/retention/orphans',{digest:orphans.digest,confirm:true});};}catch(e){message(e.message);}};
  return {destroy(){disposed=true;pending=null;preview=null;orphans=null;},revalidate:async()=>{if(selected)await load();}};
}
