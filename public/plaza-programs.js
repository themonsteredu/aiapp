/* Program content is plain validated JSON; it cannot replace the shared application flow. */
export async function mountPlazaPrograms({api,shell,esc}) {
  let disposed=false,terminated=false,ready=false,busy=false,pending=null,sequence=0,data;
  shell('광장 프로그램 준비','<main class="plaza" id="plaza-program-root">담당 자료를 확인하고 있습니다.</main>');
  const root=document.getElementById('plaza-program-root'),$=key=>root.querySelector(`[data-program="${key}"]`);
  root.innerHTML=`<h1>광장 프로그램 준비</h1><p class="plaza-pause-note">가짜 참여자만 사용하는 시험 화면입니다. 실제 학생 수집과 운영 배포는 차단돼 있습니다. 실제 키트와 시범 수업 피드백은 확인 대기입니다.</p><p>기존 <a href="#/decks">수업 자료</a>와 <a href="#/sessions">수업 코드</a>를 먼저 준비해 주세요. 담당 교안은 광장 강사 화면에서 별도로 등록합니다.</p><p role="status" data-program="status"></p>
    <section><h2>1. 수업 프로그램 준비</h2><label>진행할 수업 선택<select data-program="template"><option value="">수업 프로그램을 선택해 주세요</option></select></label><button type="button" class="btn btn-ghost" data-program="load-template">기본 설정 불러오기</button>
    <form data-program="register"><fieldset><label>연결할 수업 자료<select name="deck_id" required></select></label><div data-program="card-summary" class="plaza-pause-note">위에서 진행할 수업을 선택하고 기본 설정을 불러와 주세요.</div><label>기존 활동 연결<select data-program="activity-source"><option value="">광장 기본 구상으로 시작</option></select></label><p class="plaza-help">기존 활동이 있으면 먼저 열고, 학생이 확인한 영감을 구상과 기록으로 이어갑니다. 저장한 설정과 진행 중인 수업은 바뀌지 않습니다.</p><label>저장할 설정 버전<input type="number" name="version" min="1" max="10000" required></label><details><summary>활동 문구·선택지 편집 (고급 설정)</summary><label>수업 설정 (JSON)<textarea name="card" rows="15" spellcheck="false"></textarea></label></details><p>저장한 설정은 그대로 보관됩니다. 수업 내용을 고칠 때는 설정 버전 숫자를 올려 새로 저장해 주세요. 학생에게 보여 줄 문장만 넣고, 교안·개인정보·HTML·주소는 넣지 마세요.</p><button class="btn btn-primary">수업 설정 저장하기</button></fieldset></form></section>
    <section><h2>2. 수업에 광장 준비</h2><form data-program="prepare"><fieldset><label>담당 수업<select name="class_session_id" required></select></label><label>저장한 수업 설정<select name="program_version_id" required></select></label><label>실제 준비할 자리 수<input type="number" name="seat_count" min="1" max="100" required></label><p>수업에 자료를 배정하고 학생 공개·잠금 해제를 확인해 주세요. 준비된 광장은 선택한 수업 설정과 자리 수를 그대로 유지합니다.</p><button class="btn btn-primary">광장 준비하기</button></fieldset></form><div data-program="result"></div></section><p><a href="#/plaza-teacher">광장 수업 진행으로</a></p>`;
  root.insertAdjacentHTML('afterbegin','<nav class="plaza-lesson-flow" aria-label="공통 수업 순서"><ol><li>우리 반 입장</li><li>기존 활동 또는 기본 구상</li><li>내 가게 준비</li><li>실물 제작</li><li>광장 개장</li><li>친구와 교류</li><li>돌아보기·기록</li></ol></nav>');
  const status=message=>{if(!disposed&&$('status'))$('status').textContent=message;};
  function lock(){root.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=busy||!!pending||!ready);if(pending)$(pending.key).querySelector('button').disabled=busy||!ready;}
  const options=(rows,title)=>'<option value="">선택해 주세요</option>'+rows.map(r=>`<option value="${esc(r.id)}">${esc(title(r))}</option>`).join('');
  function choices(){
    const keep=(select,html)=>{const value=select.value;select.innerHTML=html;select.value=value;};
    keep($('register').elements.deck_id,options(data.decks,r=>`${r.title} · 자료 ${r.id}`));
    keep($('prepare').elements.class_session_id,options(data.sessions,r=>`${r.title} · 코드 ${r.code}`));
    keep($('prepare').elements.program_version_id,options(data.programs.filter(p=>p.card.display),r=>`${r.card.display.profession} · v${r.version} · ${r.deck_title}`));
    keep($('template'),options([...data.templates.map((card,i)=>({id:`pending-${i}`,label:`${card.display.profession} · 키트 확인 대기`})),...data.synthetic_templates.map((card,i)=>({id:`synthetic-${i}`,label:`${card.display.profession} · 가짜 재료 시험용`}))],r=>r.label));
  }
  function sourceChoices(card){
    const sources=(data.activity_sources||[]).filter(s=>s.program_keys.includes(card.program_key));
    $('activity-source').innerHTML='<option value="">광장 기본 구상으로 시작</option>'+sources.map(s=>`<option value="${esc(s.id)}:${s.version}">${esc(s.title)} → 영감 확인 → 광장 구상</option>`).join('');
    $('activity-source').value=card.source_activity?`${card.source_activity.id}:${card.source_activity.version}`:'';
  }
  async function refresh(){
    if(disposed||terminated)return;
    const current=++sequence;ready=false;root.hidden=true;
    try{const next=await api('GET','/api/plaza/programs');if(disposed||current!==sequence)return;data=next;choices();ready=true;root.hidden=false;lock();return true;}
    catch(error){if(!disposed&&current===sequence){if([401,403,404,410].includes(error.status)){terminated=true;pending=null;root.replaceChildren();root.textContent='프로그램 준비 권한을 다시 확인해 주세요.';root.hidden=false;}else{root.hidden=false;status('담당 자료를 확인하지 못했습니다. 연결 후 다시 열어 주세요.');root.querySelectorAll('button').forEach(b=>b.disabled=true);}}}
  }
  $('load-template').onclick=()=>{
    const [kind,index]=$('template').value.split('-');const card=(kind==='synthetic'?data.synthetic_templates:data.templates)[Number(index)];
    if(!card)return;const field=$('register').elements.card;
    if(field.value&&!confirm('작성 중인 수업 설정을 선택한 프로그램의 기본 설정으로 바꿀까요?'))return;
    sourceChoices(card);field.value=JSON.stringify(card,null,2);$('register').elements.version.value=card.version;$('card-summary').textContent=`${card.display.profession} · ${card.display.product} · ${card.materials_status} / ${card.problem}`;status('기본 설정을 불러왔습니다. 연결할 수업 자료와 설정 버전을 확인한 뒤 저장해 주세요.');
  };
  $('activity-source').onchange=()=>{
    try{const f=$('register').elements,card=JSON.parse(f.card.value),value=$('activity-source').value;
      if(value){const [id,version]=value.split(':');card.source_activity={id,version:Number(version)};}else delete card.source_activity;
      f.card.value=JSON.stringify(card,null,2);status('연결 활동을 선택했습니다. 기존 내용을 바꾸려면 설정 버전 숫자를 올려 새로 저장해 주세요.');
    }catch{status('먼저 수업을 선택하고 기본 설정을 불러와 주세요.');}
  };
  $('register').elements.card.onchange=()=>{try{sourceChoices(JSON.parse($('register').elements.card.value));}catch{status('고급 설정의 수업 설정(JSON) 형식을 확인해 주세요.');}};
  async function submit(key,path,body){
    if(disposed||terminated||busy)return;if(pending&&pending.key!==key)return;
    pending||={key,path,body};busy=true;lock();status('서버에서 확인하고 있습니다.');
    try{
      const result=await api('POST',pending.path,pending.body);if(disposed)return;
      pending=null;const refreshed=await refresh();if(disposed||terminated)return;if(!refreshed){status('서버에는 저장됐지만 목록을 새로 확인하지 못했습니다. 연결 후 이 화면을 다시 열어 주세요.');return;}
      status(result.duplicate?'같은 요청으로 이미 준비된 내용을 확인했습니다.':'서버에 저장했습니다.');
      if(key==='prepare'&&$('result'))$('result').innerHTML=`<p>광장을 준비했습니다. 입장 전 관리자가 <a href="#/plaza-retention">시험 보관 기간</a>을 등록해야 합니다.</p><a class="btn btn-primary" href="#/plaza-teacher/${esc(result.id)}">광장 수업 진행</a>`;
    }catch(error){if(!disposed){if(error.status&&error.status<500)pending=null;if([401,403].includes(error.status)){terminated=true;root.replaceChildren();root.textContent='프로그램 준비 권한을 다시 확인해 주세요.';}status(error.status&&error.status<500?error.message:'저장 확인 필요 · 같은 버튼으로 같은 내용을 다시 확인해 주세요.');}}
    finally{busy=false;if(!disposed)lock();}
  }
  $('register').onsubmit=e=>{e.preventDefault();if(pending)return void submit('register');try{const f=e.target.elements;void submit('register','/api/plaza/programs',{deck_id:Number(f.deck_id.value),card:{...JSON.parse(f.card.value),version:Number(f.version.value)}});}catch{status('고급 설정의 수업 설정(JSON) 형식을 확인해 주세요.');}};
  $('prepare').onsubmit=e=>{e.preventDefault();if(pending)return void submit('prepare');const f=e.target.elements;void submit('prepare','/api/plaza/rooms',{class_session_id:Number(f.class_session_id.value),program_version_id:f.program_version_id.value,seat_count:Number(f.seat_count.value)});};
  await refresh();
  return {revalidate:refresh,destroy(){disposed=true;sequence++;pending=null;data=null;root.replaceChildren();}};
}
