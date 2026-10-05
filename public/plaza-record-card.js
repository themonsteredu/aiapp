/* Authenticated, native record card. QR possession never authenticates the reader. */
export async function mountPlazaRecordCard({recordId,api,shell,esc}) {
  let disposed=false,sequence=0,printing=false;
  shell('내 광장 진로 카드','<main class="plaza plaza-record-screen" id="plaza-record-root"><div class="plaza-card-tools"><h1>내 광장 진로 카드</h1><p>저장된 기록과 열람 권한을 확인하고 있습니다.</p></div></main>');
  const root=document.getElementById('plaza-record-root');
  const stopPrint=()=>{printing=false;document.body.classList.remove('allow-print','plaza-card-print');};
  function clear(message){sequence++;stopPrint();if(!disposed)root.innerHTML=`<div class="plaza-card-tools"><h1>내 광장 진로 카드</h1><p role="status">${esc(message)}</p><button class="btn btn-primary" data-card="retry">다시 확인하기</button><p><a href="#/career-records">내 진로기록으로</a></p></div>`;const button=root.querySelector('[data-card="retry"]');if(button)button.onclick=()=>void load();}
  async function load() {
    if(disposed)return false;
    clear('저장된 기록과 열람 권한을 확인하고 있습니다.');const current=sequence;
    try {
      const data=await api('GET',`/api/career-log/records/${recordId}/card`);
      if(disposed||current!==sequence||document.visibilityState==='hidden'||navigator.onLine===false)return false;
      const r=data.record;
      root.innerHTML=`<div class="plaza-card-tools"><h1>내 광장 진로 카드</h1><p>${esc(data.access_note)}</p><p class="plaza-pause-note">가짜 참여자로 하는 시험용입니다. 이 QR 주소는 시험 환경에서만 열립니다. 실제 수업용 QR 발급은 아직 시작하지 않습니다.</p><button type="button" class="btn btn-primary" data-card="print">내용 확인 후 인쇄하기</button> <a class="btn btn-ghost" href="#/career-records">내 진로기록으로</a><p data-card="status" role="status"></p></div>
        <article class="plaza-career-card" aria-label="저장된 광장 진로기록"><header><p class="plaza-kicker">모아킷 · 모아랩 / 광장</p><h2>${esc(r.title||'오늘의 광장 경험')}</h2><p>${esc(new Date(r.occurred_at).toLocaleDateString('ko-KR'))} · 서버에 저장된 활동 기록</p><p>프로그램 ${esc(r.program_key)} · 카드 버전 ${esc(r.program_version)}</p></header>
        ${['process','artifact','reflection'].map((k,i)=>`<section><h3>${['활동 과정','결과물','돌아보기'][i]}</h3><p class="plaza-preserve">${esc(r[k]||'')}</p></section>`).join('')}
        <footer class="plaza-card-footer"><img data-card="qr" src="${esc(data.qr_data_url)}" width="168" height="168" alt="로그인 후 이 기록을 여는 QR"><div><strong>다시 읽는 나의 경험</strong><p>QR을 열어도 기록 열람 권한이 있어야 합니다. 수업 코드 접속은 수업 종료·만료·기기 재발급 후 사용할 수 없습니다.</p><p>가짜 참여자 시험용 · 인쇄물은 직접 보관해 주세요.</p><p class="plaza-card-address">${esc(data.url)}</p></div></footer></article>`;
      root.querySelector('[data-card="print"]').onclick=()=>void printCard();
      return true;
    }catch(error){if(!disposed&&current===sequence)clear(error.status&&error.status<500?error.message:'연결을 확인하지 못해 기록을 가렸습니다. 연결 후 다시 확인해 주세요.');return false;}
  }
  async function printCard(){
    // Fresh authorization is required for each print; the initial page response is not a reusable grant.
    if(!await load())return;
    const current=sequence,img=root.querySelector('[data-card="qr"]');
    try{if(img?.decode)await img.decode();}catch{clear('QR 이미지를 확인하지 못했습니다. 다시 확인해 주세요.');return;}
    if(disposed||current!==sequence||document.visibilityState==='hidden'||navigator.onLine===false)return;
    printing=true;document.body.classList.add('allow-print','plaza-card-print');
    try{window.print();}finally{stopPrint();}
  }
  const visibility=()=>{if(printing)return;if(document.visibilityState==='hidden')clear('화면으로 돌아오면 권한을 다시 확인합니다.');else void load();};
  const offline=()=>clear('연결이 끊겨 기록을 가렸습니다. 연결 후 다시 확인해 주세요.');
  const online=()=>void load();
  document.addEventListener('visibilitychange',visibility);window.addEventListener('offline',offline);window.addEventListener('online',online);window.addEventListener('afterprint',stopPrint);
  await load();
  return {revalidate:load,printingOwnRecord:()=>printing,destroy(){disposed=true;sequence++;stopPrint();root.replaceChildren();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('offline',offline);window.removeEventListener('online',online);window.removeEventListener('afterprint',stopPrint);}};
}
