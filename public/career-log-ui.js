export function registerCareerLogUI({ route, api, shell, state, esc, toast, navigate, isStaff }) {
  const recordUrl = '#/career-records';
  let currentClass = '';
  let renderVersion = 0;
  function viewGuard() {
    const version = ++renderVersion, hash = location.hash, actor = state.me?.id;
    return () => version === renderVersion && location.hash === hash && state.me?.id === actor;
  }
  // 모아허브에서 들어온 학교 수업 기록의 이름표. 제목이 없는 기록은 프로그램 이름으로 보여준다.
  const PROGRAM_LABELS = { 'history-ai-01': '역사 AI 수업', 'science-observation-ai-03': '자연을 관찰하는 AI', 'aviation-mobility-01': '항공 모빌리티', 'hub-submission-v1': '활동 결과물 제출', 'job-staff-record': '담당자 기록' };
  const sourceLabel = record => record.source === 'hub' ? '모아허브 · 학교 수업' : record.entry_kind === 'staff_record' ? '담당자 작성' : (!record.source || record.source === 'job') ? '모아랩 · 진로 수업' : record.source;
  const status = (message, error = false) => `<p class="career-message${error ? ' is-error' : ''}" role="${error ? 'alert' : 'status'}">${esc(message)}</p>`;

  async function ensureIdentity(current) {
    const profile = await api('GET', '/api/career-log/profile');
    if (!current()) return false;
    if (profile.staff || profile.active) return true;
    if (!profile.guest) {
      await api('POST', '/api/career-log/start', {});
      return current();
    }
    shell('내 진로기록', `<section class="career-page career-start">
      <span class="career-eyebrow">MOAKIT CAREER LOG</span><h1>수업에서 발견한 나를 기록해요.</h1>
      <p>활동 과정과 결과, 새롭게 알게 된 점을 남길 수 있어요.</p>
      ${profile.canResume ? '<p>이 기기에 이전 기록이 연결돼 있어요. 본인의 기록일 때만 이어서 시작하세요.</p>' : ''}
      <div class="career-actions">
        ${profile.canResume ? '<button class="btn btn-primary" data-career-start="resume">내 이전 기록 이어가기</button>' : ''}
        <button class="btn ${profile.canResume ? 'btn-ghost' : 'btn-primary'}" data-career-start="new">${profile.canResume ? '다른 학생 · 새로 시작' : '내 기록 시작하기'}</button>
      </div><p class="career-note">수업 코드로 참여한 기록은 이 기기에 연결됩니다. 다음 수업에서 같은 기기로 참여하면 이어갈 수 있어요. 공용 기기는 사용 후 로그아웃하세요. 다음 학생은 새로 시작을 선택하면 됩니다.</p>
      <a class="career-link" href="#/decks">수업 자료로 돌아가기</a><div id="career-start-status"></div>
    </section>`);
    document.querySelectorAll('[data-career-start]').forEach(button => {
      button.onclick = async () => {
        document.querySelectorAll('[data-career-start]').forEach(item => { item.disabled = true; });
        try { await api('POST', '/api/career-log/start', { mode: button.dataset.careerStart }); navigate(); }
        catch (error) {
          document.getElementById('career-start-status').innerHTML = status(error.message, true);
          document.querySelectorAll('[data-career-start]').forEach(item => { item.disabled = false; });
        }
      };
    });
    return false;
  }

  function recordHtml(record, staff) {
    const date = new Date(record.occurred_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
    return `<article class="career-record">
      <div class="career-record-meta"><span>${esc(date)}</span><span>${esc(sourceLabel(record))}</span><span>${record.supersedes_id ? '담당자 정정' : record.source === 'hub' ? '수업 활동 기록' : record.entry_kind === 'staff_record' ? '담당자 기록' : '학생 작성'}</span></div>
      <h2>${esc(record.title || PROGRAM_LABELS[record.program_ref] || '진로 활동')}</h2><p class="career-record-sub">${staff ? `${esc(record.student_name || '학생')} · ` : ''}${esc(record.session_title || '')}</p>
      <dl><div><dt>활동 과정</dt><dd>${esc(record.process)}</dd></div>${record.artifact ? `<div><dt>결과물</dt><dd>${esc(record.artifact)}</dd></div>` : ''}${record.reflection ? `<div><dt>돌아보기</dt><dd>${esc(record.reflection)}</dd></div>` : ''}</dl>
      <details class="career-receipt"><summary>저장 접수번호</summary><code>${esc(record.id)}</code></details>
    </article>`;
  }

  route(/^#\/career-records$/, async () => {
    const current = viewGuard();
    shell(isStaff() ? '수업 진로기록' : '내 진로기록', status('기록을 불러오고 있어요.'));
    try {
      if (!(await ensureIdentity(current))) return;
      const staff = isStaff();
      const classes = staff ? (await api('GET', '/api/career-log/classes')).classes : [];
      if (!current()) return;
      if (currentClass && !classes.some(item => item.session_ref === currentClass)) currentClass = '';
      shell(staff ? '수업 진로기록' : '내 진로기록', `<section class="career-page">
        <div class="career-heading"><div><span class="career-eyebrow">MOAKIT CAREER LOG</span><h1>${staff ? '수업에서 남긴 배움의 기록' : '경험이 쌓이는 나의 진로기록'}</h1><p>${staff ? '담당 수업에서 학생이 직접 작성한 기록을 확인하세요.' : '내가 한 활동과 결과, 달라진 생각을 모아 보세요.'}</p></div>
        ${staff ? '' : '<a class="btn btn-primary" href="#/career-records/new">기록 남기기</a>'}</div>
        ${staff ? `<label class="career-filter">수업 선택<select id="career-class"><option value="">전체 담당 수업</option>${classes.map(item => `<option value="${esc(item.session_ref)}"${currentClass === item.session_ref ? ' selected' : ''}>${esc(item.title || '수업')} · ${item.count}개</option>`).join('')}</select></label>` : ''}
        <div id="career-records-list" class="career-records-list" aria-live="polite"></div>
        <div id="career-list-status"></div><button id="career-more" class="btn btn-ghost" hidden>기록 더 보기</button>
        <p class="career-note">${!staff && state.me.schoolAccount ? '학교 계정으로 로그인해 모아허브 학교 수업 기록과 모아랩 진로 수업 기록이 한 사람의 기록으로 함께 표시됩니다. 체험 앱의 자동 제출 기록은 별도 연결 대상입니다.' : 'JOB에서 직접 작성한 기록이 표시됩니다. 체험 앱의 자동 제출 기록은 별도 연결 대상입니다.'}${!staff && state.me.isGuest ? ' 수업 종료 후에는 다음 수업 코드로 참여해 이전 기록을 이어갈 수 있어요. 기기·브라우저를 바꾸거나 사이트 데이터를 지우면 이 연결이 유지되지 않습니다.' : ''}</p>
      </section>`);
      let page = 0;
      let busy = false;
      const load = async () => {
        if (busy) return;
        busy = true;
        const more = document.getElementById('career-more');
        more.disabled = true;
        document.getElementById('career-list-status').innerHTML = status('불러오는 중…');
        try {
          const data = await api('GET', `/api/career-log/records?page=${page}${currentClass ? `&class=${encodeURIComponent(currentClass)}` : ''}`);
          if (!current()) return;
          const list = document.getElementById('career-records-list');
          if (!list) return;
          if (page === 0 && !data.records.length) list.innerHTML = `<div class="career-empty"><h2>아직 남긴 기록이 없어요.</h2><p>${staff ? '학생이 수업 자료를 열고 ‘활동 기록 남기기’를 누르면 여기에 모입니다.' : '수업을 마친 뒤 첫 기록을 남겨 보세요.'}</p>${staff ? '' : '<a class="career-link" href="#/career-records/new">첫 기록 남기기 →</a>'}</div>`;
          else list.insertAdjacentHTML('beforeend', data.records.map(record => recordHtml(record, staff)).join(''));
          more.hidden = !data.hasMore;
          page += 1;
          document.getElementById('career-list-status').innerHTML = '';
        } catch (error) {
          if (!current()) return;
          const message = document.getElementById('career-list-status');
          if (message) message.innerHTML = status(error.message, true);
          more.hidden = false;
          more.textContent = '다시 불러오기';
        } finally { busy = false; more.disabled = false; }
      };
      const filter = document.getElementById('career-class');
      if (filter) filter.onchange = () => { currentClass = filter.value; navigate(); };
      document.getElementById('career-more').onclick = load;
      await load();
    } catch (error) { if (!current()) return; shell('진로기록', `${status(error.message, true)}<a class="btn btn-ghost" href="#/decks">수업 자료로 돌아가기</a>`); }
  });

  route(/^#\/career-records\/new(?:\/(\d+))?$/, async (selectedId) => {
    const current = viewGuard();
    if (isStaff()) { location.hash = recordUrl; return; }
    shell('기록 남기기', status('수업을 확인하고 있어요.'));
    try {
      if (!(await ensureIdentity(current))) return;
      const { decks } = await api('GET', '/api/decks');
      if (!current()) return;
      const available = decks.filter(deck => !deck.locked);
      if (!available.length) {
        shell('기록 남기기', `${status('지금 기록할 수 있는 수업이 없습니다. 선생님이 수업 자료를 열어 주면 작성할 수 있어요.')}<a class="btn btn-ghost" href="${recordUrl}">내 기록 보기</a>`);
        return;
      }
      shell('기록 남기기', `<section class="career-page career-compose">
        <a class="career-link" href="${recordUrl}">← 내 진로기록</a><span class="career-eyebrow">MOAKIT CAREER LOG</span><h1>오늘의 활동을 남겨요.</h1>
        <form id="career-form">
          <label for="career-deck">수업</label><select id="career-deck" name="deck_id" required>${available.map(deck => `<option value="${deck.id}"${String(deck.id) === selectedId ? ' selected' : ''}>${esc(deck.title)}</option>`).join('')}</select>
          <label for="career-process">어떤 활동을 했나요?</label><textarea id="career-process" name="process" rows="4" maxlength="1500" placeholder="내가 조사하거나 만들고, 직접 판단한 과정을 적어 주세요." required></textarea>
          <label for="career-artifact">어떤 결과물을 만들었나요? <span>선택</span></label><textarea id="career-artifact" name="artifact" rows="3" maxlength="1500" placeholder="보고서·레시피·분석 결과 등을 설명하거나 결과물 주소를 적어 주세요."></textarea>
          <label for="career-reflection">새롭게 알게 된 점은 무엇인가요?</label><textarea id="career-reflection" name="reflection" rows="4" maxlength="1000" placeholder="생각이 바뀐 부분이나 다음에 더 해 보고 싶은 일을 적어 주세요." required></textarea>
          <p class="career-note">저장한 기록은 원본으로 보관됩니다. 덧붙일 내용은 새 기록으로 남겨 주세요. 담당 선생님도 이 기록을 볼 수 있어요.</p>
          <div id="career-save-status" aria-live="polite"></div><div class="career-actions"><button id="career-save" class="btn btn-primary" type="submit">진로기록 저장</button><a class="btn btn-ghost" href="${recordUrl}">내 기록 확인</a></div>
        </form>
      </section>`);
      let lastPayload = null;
      let lastFields = '';
      document.getElementById('career-form').onsubmit = async event => {
        event.preventDefault();
        const button = document.getElementById('career-save');
        if (button.disabled) return;
        const form = new FormData(event.target);
        const fields = { deck_id: Number(form.get('deck_id')), process: String(form.get('process')).trim(), artifact: String(form.get('artifact')).trim(), reflection: String(form.get('reflection')).trim() };
        const snapshot = JSON.stringify(fields);
        if (!lastPayload || snapshot !== lastFields) { lastPayload = { ...fields, attempt_id: crypto.randomUUID() }; lastFields = snapshot; }
        button.disabled = true;
        button.textContent = '저장 중…';
        try {
          const result = await api('POST', '/api/career-log/records', lastPayload);
          if (!result.saved || !result.id) throw new Error('저장 확인을 받지 못했습니다. 내 기록을 확인한 뒤 다시 시도해 주세요.');
          if (!current()) return;
          toast('진로기록이 저장됐어요.');
          location.hash = recordUrl;
        } catch (error) {
          const message = document.getElementById('career-save-status');
          if (message) message.innerHTML = status(`${error.message} 저장 결과가 불확실하면 내 기록을 먼저 확인해 주세요.`, true);
          button.disabled = false;
          button.textContent = '다시 저장하기';
        }
      };
    } catch (error) { if (!current()) return; shell('기록 남기기', `${status(error.message, true)}<a class="btn btn-ghost" href="${recordUrl}">내 기록 보기</a>`); }
  });
}
