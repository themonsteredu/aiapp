'use strict';

const SESSION_TITLES = [
  'AI가 놓친 광주를 발견하다',
  '진짜 이유와 사용자의 문제를 찾다',
  '같은 문제를 다른 직무의 눈으로 보다',
  '나에게 맞는 역할로 웹앱을 기획하다',
  '모아랩에서 AI 웹앱을 제작하고 테스트하다',
  '광주 AI 웹앱 박람회',
];

const ROLE_NAMES = [
  'AI 서비스 기획자',
  '광주자원 데이터 큐레이터',
  'UX/UI 디자이너',
  'AI 기능·검증 담당자',
  '브랜드·피칭 담당자',
];

const LABELS = {
  interestedResources: '관심 광주자원',
  aiGapMemo: 'AI 오류·누락 메모',
  targetUser: '세부 사용자',
  inconvenience: '불편한 상황',
  cause: '문제 원인',
  currentSolution: '현재 해결방법',
  problemStatement: '문제정의 문장',
  successCriteria1: '성공기준 1',
  successCriteria2: '성공기준 2',
  careerPrimary: '관심 직무 1순위',
  careerSecondary: '관심 직무 2순위',
  personalRole: '개인 선택 역할',
  roleReason: '역할 선택 이유',
  teamRoleTable: '팀 역할표',
  improvementList: '개선 목록',
  pitchSummary: '피칭 요약',
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === '' ? [] : [value];
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ko-KR');
}

function copyText(value, toast) {
  navigator.clipboard?.writeText(String(value)).then(
    () => toast('복사했습니다.'),
    () => toast('복사하지 못했습니다.', true)
  );
}

function formDataObject(form) {
  const out = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (out[key] === undefined) out[key] = value;
    else if (Array.isArray(out[key])) out[key].push(value);
    else out[key] = [out[key], value];
  }
  return out;
}

function textField(esc, name, label, value = '', placeholder = '') {
  return `<label class="project-field"><span>${esc(label)}</span>
    <input name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`;
}

function textArea(esc, name, label, value = '', placeholder = '', rows = 4) {
  return `<label class="project-field project-span-2"><span>${esc(label)}</span>
    <textarea name="${esc(name)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
}

function selectField(esc, name, label, options, value = '') {
  return `<label class="project-field"><span>${esc(label)}</span>
    <select name="${esc(name)}" required>
      <option value="">선택하세요</option>
      ${options.map((item) => `<option value="${esc(item)}" ${String(value) === String(item) ? 'selected' : ''}>${esc(item)}</option>`).join('')}
    </select></label>`;
}

function sessionStatusClass(status) {
  if (status === '확정') return 'is-done';
  if (status === '작성 중') return 'is-writing';
  return 'is-idle';
}

function renderReadableData(esc, value) {
  if (!value || typeof value !== 'object' || !Object.keys(value).length) {
    return '<div class="project-empty">저장된 내용이 없습니다.</div>';
  }
  const rows = [];
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'appPlan' && raw && typeof raw === 'object') {
      rows.push(`<div class="project-result-group"><b>웹앱 기획서</b>${renderReadableData(esc, raw)}</div>`);
      continue;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      rows.push(`<div class="project-result-group"><b>${esc(LABELS[key] || key)}</b>${renderReadableData(esc, raw)}</div>`);
      continue;
    }
    const shown = Array.isArray(raw) ? raw.join(', ') : String(raw || '');
    if (!shown) continue;
    rows.push(`<div class="project-result-row"><span>${esc(LABELS[key] || key)}</span><b>${esc(shown)}</b></div>`);
  }
  return rows.length ? `<div class="project-result-list">${rows.join('')}</div>` : '<div class="project-empty">저장된 내용이 없습니다.</div>';
}

export function registerProjectUI(deps) {
  const {
    route, api, shell, state, esc, icon, toast, openModal, navigate, level, $app,
  } = deps;

  function staffOnly() {
    if (!state.me || level(state.me.role) < 1) {
      location.hash = '#/';
      return false;
    }
    return true;
  }

  function projectBadge(status) {
    const map = {
      active: ['운영 중', 'green'],
      archived: ['운영 종료', 'gray'],
      draft: ['준비 중', 'blue'],
    };
    const [label, color] = map[status] || [status || '운영 중', 'gray'];
    return `<span class="badge ${color}">${esc(label)}</span>`;
  }

  function projectStats(projects) {
    const active = projects.filter((project) => project.status !== 'archived').length;
    const teams = projects.reduce((sum, project) => sum + Number(project.teamCount || 0), 0);
    const published = projects.reduce((sum, project) => sum + Number(project.publishedCount || 0), 0);
    const sessionAverage = projects.length
      ? (projects.reduce((sum, project) => sum + Number(project.currentSession || 1), 0) / projects.length).toFixed(1)
      : '0';
    return `
      <div class="project-stat-grid">
        <div class="project-stat"><span>운영 프로젝트</span><strong>${active}</strong><small>개</small></div>
        <div class="project-stat"><span>참여 팀</span><strong>${teams}</strong><small>팀</small></div>
        <div class="project-stat"><span>평균 공개 차시</span><strong>${sessionAverage}</strong><small>차시</small></div>
        <div class="project-stat"><span>배포 완료</span><strong>${published}</strong><small>팀</small></div>
      </div>`;
  }

  function openCreateProject() {
    const today = new Date();
    const end = new Date(today);
    end.setDate(end.getDate() + 30);
    const iso = (date) => date.toISOString().slice(0, 10);
    const back = openModal(`
      <form id="project-create-form">
        <h3>AI 프로젝트 개설</h3>
        <div class="m-sub">기존 수업코드 체계 안에 광주픽 6차시 프로젝트를 만듭니다.</div>
        <div class="project-form-grid">
          ${textField(esc, 'title', '프로젝트명', '광주 AI 웹앱 만들기', '프로젝트명을 입력하세요')}
          ${textField(esc, 'teamCount', '팀 수', '6', '1~20')}
          ${textField(esc, 'schoolLabel', '학교', '', '예: ○○중학교')}
          ${textField(esc, 'classLabel', '학급', '', '예: 1학년 2반')}
          ${textField(esc, 'startsOn', '시작일', iso(today))}
          ${textField(esc, 'endsOn', '종료일', iso(end))}
          ${textArea(esc, 'mission', '공통 미션', '광주 지역자원을 검증하고, 우리 팀의 추천형 AI 웹앱을 완성한다.', '', 3)}
        </div>
        <div class="project-privacy-note">학생 계정이나 실명은 만들지 않습니다. 프로젝트 개설 후 수업코드와 팀코드가 자동 생성됩니다.</div>
        <div class="m-actions">
          <button class="btn btn-ghost" type="button" data-close>취소</button>
          <button class="btn btn-primary" type="submit">프로젝트 개설</button>
        </div>
      </form>`);
    back.querySelector('[data-close]').onclick = () => back.remove();
    back.querySelector('#project-create-form').onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = formDataObject(form);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await api('POST', '/api/projects', {
          ...data,
          teamCount: Number(data.teamCount),
        });
        back.remove();
        toast(`프로젝트를 개설했습니다. 입장코드 ${result.classCode}`);
        location.hash = `#/projects/${result.projectId}`;
      } catch (error) {
        toast(error.message, true);
        submit.disabled = false;
      }
    };
  }

  route(/^#\/projects$/, async () => {
    if (!staffOnly()) return;
    const { projects } = await api('GET', '/api/projects');
    shell('AI 프로젝트', `
      <div class="project-page-head">
        <div>
          <div class="project-eyebrow">학교수업용 AI 웹앱 프로젝트</div>
          <h2>프로젝트 운영 현황</h2>
          <p>기존 수업코드와 권한 체계를 그대로 사용해 팀별 제작 과정을 관리합니다.</p>
        </div>
        <button class="btn btn-primary" id="project-create">${icon('plus')} 프로젝트 개설</button>
      </div>
      ${projectStats(projects)}
      <div class="project-list">
        ${projects.length ? projects.map((project) => {
          const pct = Math.round((Number(project.currentSession || 1) / 6) * 100);
          return `
            <article class="project-card">
              <div class="project-card-main">
                <div class="project-card-title">${esc(project.title)} ${projectBadge(project.status)}</div>
                <div class="project-card-meta">
                  <span>${esc([project.schoolLabel, project.classLabel].filter(Boolean).join(' · ') || '대상 미지정')}</span>
                  <span>${esc(project.startsOn || '시작일 미정')} ~ ${esc(project.endsOn || '종료일 미정')}</span>
                  <span>입장코드 <b>${esc(project.classCode || '-')}</b></span>
                </div>
                <div class="project-progress"><i style="width:${pct}%"></i></div>
                <div class="project-card-foot">
                  <span>현재 ${project.currentSession}차시 공개</span>
                  <span>참여 ${project.teamCount || 0}팀</span>
                  <span>배포 ${project.publishedCount || 0}팀</span>
                </div>
              </div>
              <a class="btn btn-ghost" data-project-open href="#/projects/${project.id}">프로젝트 관리 ${icon('chevRight')}</a>
            </article>`;
        }).join('') : `
          <div class="project-empty project-empty-large">
            <b>아직 개설된 AI 프로젝트가 없습니다.</b>
            <span>첫 광주픽 수업 프로젝트를 개설해 보세요.</span>
          </div>`}
      </div>`);
    document.getElementById('project-create').onclick = openCreateProject;
    document.querySelectorAll('[data-project-open]').forEach((link) => {
      link.onclick = () => {
        link.classList.add('is-loading');
        link.setAttribute('aria-busy', 'true');
        link.textContent = '불러오는 중';
      };
    });
  });

  async function openTeamDetail(projectId, teamId) {
    const data = await api('GET', `/api/projects/${projectId}/teams/${teamId}`);
    const back = openModal(`
      <div class="project-team-modal">
        <div class="project-team-modal-head">
          <div>
            <h3>${esc(data.team.name)}</h3>
            <div class="m-sub">팀코드 ${esc(data.team.code)} · ${esc(data.team.status)}</div>
          </div>
          ${data.team.publishedSlug ? `<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="#/p/${esc(data.team.publishedSlug)}">최종 앱 열기</a>` : ''}
        </div>
        <div class="project-tabs" role="tablist">
          ${SESSION_TITLES.map((title, index) => `<button class="${index === 0 ? 'active' : ''}" data-team-tab="${index + 1}">${index + 1}차시</button>`).join('')}
          <button data-team-tab="config">앱 설정</button>
          <button data-team-tab="feedback">테스트·성찰</button>
        </div>
        <div id="project-team-result"></div>
        <div class="m-actions"><button class="btn btn-ghost" data-close>닫기</button></div>
      </div>`);
    const result = back.querySelector('#project-team-result');
    const show = (tab) => {
      back.querySelectorAll('[data-team-tab]').forEach((button) => button.classList.toggle('active', button.dataset.teamTab === String(tab)));
      if (/^[1-6]$/.test(String(tab))) {
        const row = data.progress.find((item) => Number(item.session_no) === Number(tab));
        result.innerHTML = `
          <div class="project-result-head"><b>${tab}차시 · ${esc(SESSION_TITLES[tab - 1])}</b>
            <span class="badge ${row?.status === '확정' ? 'green' : row?.status === '작성 중' ? 'blue' : 'gray'}">${esc(row?.status || '미시작')}</span>
          </div>
          ${renderReadableData(esc, row?.confirmed_data || row?.draft_data || {})}`;
      } else if (tab === 'config') {
        result.innerHTML = `
          <div class="project-result-head"><b>현재 웹앱 설정</b><span>${esc(dateText(data.configUpdatedAt))}</span></div>
          ${renderReadableData(esc, data.config)}
          <div class="project-version-list">
            ${data.versions.map((version) => `<span>v${version.version_no} · ${esc(version.status)} · ${esc(dateText(version.created_at))}</span>`).join('') || '저장된 버전이 없습니다.'}
          </div>`;
      } else {
        result.innerHTML = `
          <div class="project-result-head"><b>사용자 테스트</b><span>${data.feedback.length}건</span></div>
          ${data.feedback.map((item) => `<div class="project-feedback-card">
            <b>${esc(item.tester_code || '익명 테스트')}</b>
            <p><span>좋았던 점</span>${esc(item.liked)}</p>
            <p><span>어려웠던 점</span>${esc(item.confusing)}</p>
            <p><span>제안</span>${esc(item.suggestion)}</p>
          </div>`).join('') || '<div class="project-empty">저장된 테스트 의견이 없습니다.</div>'}
          <div class="project-result-head project-result-section"><b>개인 진로성찰</b><span>${data.reflections.length}건</span></div>
          ${data.reflections.map((item) => `<div class="project-feedback-card"><b>${esc(item.anonymous_no)}</b>${renderReadableData(esc, item.reflection)}</div>`).join('') || '<div class="project-empty">저장된 성찰이 없습니다.</div>'}`;
      }
    };
    back.querySelectorAll('[data-team-tab]').forEach((button) => {
      button.onclick = () => show(button.dataset.teamTab);
    });
    back.querySelector('[data-close]').onclick = () => back.remove();
    show(1);
  }

  route(/^#\/projects\/(\d+)$/, async (id) => {
    if (!staffOnly()) return;
    shell('프로젝트 관리', `
      <section class="project-section project-route-state" aria-live="polite">
        <div class="project-route-spinner" aria-hidden="true"></div>
        <div><h3>프로젝트를 불러오는 중입니다</h3><p>팀별 진행 현황을 확인하고 있습니다.</p></div>
      </section>`);
    let data;
    try {
      data = await api('GET', `/api/projects/${id}`);
    } catch (error) {
      shell('프로젝트 관리', `
        <section class="project-section project-route-state project-route-error" role="alert">
          <div>
            <h3>프로젝트를 열지 못했습니다</h3>
            <p>${esc(error.message || '잠시 후 다시 시도해 주세요.')}</p>
          </div>
          <div class="project-route-actions">
            <a class="btn btn-ghost" href="#/projects">목록으로</a>
            <button class="btn btn-primary" id="project-route-retry">다시 시도</button>
          </div>
        </section>`);
      document.getElementById('project-route-retry').onclick = navigate;
      return;
    }
    const project = data.project;
    const visibility = Array.isArray(project.sessionVisibility) ? [...project.sessionVisibility] : [true, false, false, false, false, false];
    const teamProgress = new Map();
    for (const row of (data.progress || [])) teamProgress.set(`${row.team_id}:${row.session_no}`, row.status);
    shell(project.title, `
      <div class="project-page-head">
        <div>
          <a class="project-back" href="#/projects">← AI 프로젝트</a>
          <h2>${esc(project.title)}</h2>
          <p>${esc(project.mission || '광주 지역자원을 검증하고 추천형 웹앱을 완성합니다.')}</p>
        </div>
        <div class="project-code-box">
          <span>학생 입장코드</span><strong>${esc(project.classCode)}</strong>
          <button class="btn btn-ghost btn-sm" id="copy-class-code">복사</button>
        </div>
      </div>
      <section class="project-section">
        <div class="project-section-head">
          <div><h3>차시 공개 설정</h3><p>교사가 공개한 차시까지만 학생이 열 수 있습니다.</p></div>
          <span>현재 ${project.currentSession}차시</span>
        </div>
        <div class="project-session-control">
          ${SESSION_TITLES.map((title, index) => {
            const no = index + 1;
            const open = visibility[index] !== false && no <= project.currentSession;
            return `<button class="${open ? 'open' : ''}" data-open-session="${no}">
              <i>${icon(open ? 'check' : 'lock')}</i><b>${no}차시</b><span>${esc(title)}</span>
            </button>`;
          }).join('')}
        </div>
        ${project.currentSession < 6 ? `<button class="btn btn-primary project-next-open" id="open-next-session">${project.currentSession + 1}차시 공개</button>` : ''}
      </section>
      <section class="project-section">
        <div class="project-section-head">
          <div><h3>팀별 진행 현황</h3><p>팀코드, 차시 상태, 마지막 저장과 배포 결과를 확인합니다.</p></div>
          <span>${data.teams.length}팀</span>
        </div>
        <div class="project-team-table-wrap">
          <table class="project-team-table">
            <thead><tr><th>팀</th><th>팀코드</th><th>진행</th><th>상태</th><th>마지막 저장</th><th>결과</th></tr></thead>
            <tbody>
              ${data.teams.map((team) => `
                <tr>
                  <td><b>${esc(team.name)}</b><small>참여 ${team.memberCount}명</small></td>
                  <td><button class="project-code-copy" data-copy="${esc(team.code)}">${esc(team.code)}</button></td>
                  <td>
                    <div class="project-mini-steps">
                      ${[1, 2, 3, 4, 5, 6].map((no) => `<i class="${sessionStatusClass(teamProgress.get(`${team.id}:${no}`))}" title="${no}차시"></i>`).join('')}
                    </div>
                    <small>${team.progressSession || 0}/6차시</small>
                  </td>
                  <td><span class="badge ${team.status === '배포 완료' ? 'green' : team.status === '미시작' ? 'gray' : 'blue'}">${esc(team.status)}</span></td>
                  <td>${esc(dateText(team.lastSavedAt))}</td>
                  <td><button class="btn btn-ghost btn-sm" data-team-detail="${team.id}">결과 보기</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>`);
    document.getElementById('copy-class-code').onclick = () => copyText(project.classCode, toast);
    document.querySelectorAll('[data-copy]').forEach((button) => {
      button.onclick = () => copyText(button.dataset.copy, toast);
    });
    document.querySelectorAll('[data-team-detail]').forEach((button) => {
      button.onclick = () => openTeamDetail(id, button.dataset.teamDetail).catch((error) => toast(error.message, true));
    });
    document.querySelectorAll('[data-open-session]').forEach((button) => {
      button.onclick = async () => {
        const target = Number(button.dataset.openSession);
        const nextVisibility = Array.from({ length: 6 }, (_, index) => index < target);
        await api('PATCH', `/api/projects/${id}`, { currentSession: target, sessionVisibility: nextVisibility });
        toast(`${target}차시까지 공개했습니다.`);
        navigate();
      };
    });
    const next = document.getElementById('open-next-session');
    if (next) {
      next.onclick = async () => {
        const target = Math.min(6, Number(project.currentSession) + 1);
        const nextVisibility = Array.from({ length: 6 }, (_, index) => index < target);
        await api('PATCH', `/api/projects/${id}`, { currentSession: target, sessionVisibility: nextVisibility });
        toast(`${target}차시를 공개했습니다.`);
        navigate();
      };
    }
  });

  function projectStepper(current, selected) {
    const progress = new Map(current.progress.map((row) => [Number(row.session_no), row]));
    const visible = Array.isArray(current.project.sessionVisibility) ? current.project.sessionVisibility : [];
    return `<div class="student-project-stepper">
      ${SESSION_TITLES.map((title, index) => {
        const no = index + 1;
        const row = progress.get(no);
        const open = no <= current.project.currentSession && visible[index] !== false;
        const cls = [
          no === selected ? 'active' : '',
          row?.status === '확정' ? 'done' : '',
          open ? 'open' : 'locked',
        ].filter(Boolean).join(' ');
        return open
          ? `<a class="${cls}" href="#/project/${no}"><i>${row?.status === '확정' ? '✓' : no}</i><span>${no}차시</span></a>`
          : `<span class="${cls}" title="교사가 아직 공개하지 않았습니다"><i>${icon('lock')}</i><span>${no}차시</span></span>`;
      }).join('<b></b>')}
    </div>`;
  }

  function resourceChecks(resources, selected = [], name = 'selectedResources') {
    const picked = new Set(asArray(selected).map(String));
    return `<div class="project-resource-grid project-span-2">
      ${resources.map((resource) => `<label class="project-resource-choice">
        <input type="checkbox" name="${name}" value="${esc(resource.id)}" ${picked.has(String(resource.id)) ? 'checked' : ''}>
        <span><b>${esc(resource.name)}</b><small>${esc(resource.summary)}</small>
          <em>${esc(resource.verificationStatus)} · ${esc(resource.checkedAt || '확인일 미정')}</em></span>
      </label>`).join('')}
    </div>`;
  }

  function sessionOne(current, data) {
    return `
      <div class="project-lesson-intro">검증된 광주자원과 AI가 알려준 내용을 비교하고, 우리 팀이 탐구할 자원 3개를 고릅니다.</div>
      <div class="project-form-grid">
        <div class="project-field project-span-2"><span>관심 광주자원 3개</span></div>
        ${resourceChecks(current.resources, data.interestedResources || [])}
        ${textArea(esc, 'aiGapMemo', 'AI 오류·누락 메모', data.aiGapMemo, 'AI가 놓쳤거나 부정확하게 설명한 내용을 적어 보세요.')}
        ${selectField(esc, 'careerInterest', '진로활동 관심도', ['1 낮음', '2', '3 보통', '4', '5 높음'], data.careerInterest)}
        ${selectField(esc, 'aiConfidence', 'AI 정보 신뢰도', ['1 낮음', '2', '3 보통', '4', '5 높음'], data.aiConfidence)}
      </div>`;
  }

  function sessionTwo(data) {
    return `
      <div class="project-lesson-intro">추천을 받을 사용자를 구체적으로 정하고 실제 불편과 성공기준을 정의합니다.</div>
      <div class="project-form-grid">
        ${textField(esc, 'targetUser', '세부 사용자', data.targetUser, '예: 광주에서 주말 활동을 찾는 중학생')}
        ${textField(esc, 'inconvenience', '불편한 상황', data.inconvenience, '어떤 순간에 불편한가요?')}
        ${textArea(esc, 'cause', '문제 원인', data.cause, '왜 이 문제가 생기는지 적어 보세요.')}
        ${textArea(esc, 'currentSolution', '현재 해결방법', data.currentSolution, '지금은 어떻게 해결하고 있나요?')}
        ${textArea(esc, 'problemStatement', '문제정의 문장', data.problemStatement, '○○한 사용자는 △△ 때문에 □□하기 어렵다.')}
        ${textField(esc, 'successCriteria1', '성공기준 1', data.successCriteria1, '예: 조건에 맞는 자원 3개가 나온다')}
        ${textField(esc, 'successCriteria2', '성공기준 2', data.successCriteria2, '예: 모든 추천에 공식 출처가 있다')}
      </div>`;
  }

  function sessionThree(data) {
    return `
      <div class="project-lesson-intro">같은 문제를 다섯 직무의 관점으로 판단하고 나에게 맞는 직무를 찾습니다.</div>
      <div class="project-form-grid">
        ${ROLE_NAMES.map((role, index) => textArea(
          esc,
          `roleDecision${index + 1}`,
          role,
          data[`roleDecision${index + 1}`],
          `${role}라면 무엇을 가장 중요하게 볼까요?`,
          3
        )).join('')}
        ${selectField(esc, 'careerPrimary', '관심 직무 1순위', ROLE_NAMES, data.careerPrimary)}
        ${selectField(esc, 'careerSecondary', '관심 직무 2순위', ROLE_NAMES, data.careerSecondary)}
      </div>`;
  }

  function sessionFour(current, data) {
    const plan = data.appPlan || {};
    const weights = plan.weights || {};
    return `
      <div class="project-lesson-intro">팀의 역할과 추천기준을 정하면 5차시에서 사용할 웹앱 초안이 자동으로 만들어집니다.</div>
      <div class="project-form-grid">
        ${selectField(esc, 'personalRole', '나의 최종 역할', ROLE_NAMES, plan.personalRole || data.personalRole)}
        ${textField(esc, 'roleReason', '역할 선택 이유', plan.roleReason || data.roleReason, '흥미·강점·가치관과 연결해 보세요')}
        ${textArea(esc, 'teamRoleTable', '팀 역할표', plan.teamRoleTable || data.teamRoleTable, '익명번호와 역할을 한 줄씩 적어 보세요.', 4)}
        ${textField(esc, 'serviceName', '서비스명', plan.serviceName || '광주픽', '예: 광주픽')}
        ${textField(esc, 'tagline', '한 줄 소개', plan.tagline || '', '관심사·시간·예산에 맞는 광주 자원을 추천합니다.')}
        ${textField(esc, 'slogan', '서비스 슬로건', plan.slogan || '', '광주를 고르는 새로운 기준')}
        <label class="project-field"><span>대표 색상</span><input type="color" name="primaryColor" value="${esc(plan.primaryColor || '#6D3AF2')}"></label>
        <div class="project-field project-span-2"><span>사용할 광주자원</span></div>
        ${resourceChecks(current.resources, plan.selectedResources || [])}
        <div class="project-weight-grid project-span-2">
          ${[
            ['interest', '관심사', 40],
            ['time', '시간', 20],
            ['budget', '예산', 15],
            ['activity', '활동 유형', 15],
            ['companion', '동행 형태', 10],
          ].map(([key, label, fallback]) => `<label><span>${label}</span><input type="number" name="weight_${key}" min="0" max="100" value="${Number(weights[key] ?? fallback)}"></label>`).join('')}
        </div>
      </div>`;
  }

  function sessionFive(current, data) {
    const config = current.config || {};
    const questions = config.questions || {};
    const options = config.options || {};
    const weights = config.weights || {};
    const selected = new Set(asArray(config.resourceIds).map(String));
    const overrides = config.resourceOverrides || {};
    return `
      <div class="project-lesson-intro">고정된 4개 화면의 내용과 추천기준만 안전하게 편집합니다. 서버·인증·공식 출처 영역은 바꿀 수 없습니다.</div>
      <div class="project-builder-layout">
        <div class="project-builder-panel">
          <div class="project-form-grid">
            ${textField(esc, 'serviceName', '서비스명', config.serviceName, '광주픽')}
            ${textField(esc, 'tagline', '한 줄 소개', config.tagline, '')}
            ${textField(esc, 'slogan', '슬로건', config.slogan, '')}
            ${textField(esc, 'startButton', '시작 버튼 문구', config.startButton, '')}
            <label class="project-field"><span>대표 색상</span><input type="color" name="primaryColor" value="${esc(config.primaryColor || '#6D3AF2')}"></label>
            <label class="project-field"><span>보조 색상</span><input type="color" name="accentColor" value="${esc(config.accentColor || '#FFCC4D')}"></label>
            ${[
              ['interest', '관심사 질문'],
              ['time', '시간 질문'],
              ['budget', '예산 질문'],
              ['activity', '활동 유형 질문'],
              ['companion', '동행 형태 질문'],
            ].map(([key, label]) => textField(esc, `question_${key}`, label, questions[key], '')).join('')}
            ${[
              ['interest', '관심사 선택지'],
              ['time', '시간 선택지'],
              ['budget', '예산 선택지'],
              ['activity', '활동 유형 선택지'],
              ['companion', '동행 형태 선택지'],
            ].map(([key, label]) => textField(esc, `options_${key}`, label, asArray(options[key]).join(', '), '쉼표로 구분')).join('')}
            <div class="project-weight-grid project-span-2">
              ${[
                ['interest', '관심사'],
                ['time', '시간'],
                ['budget', '예산'],
                ['activity', '활동 유형'],
                ['companion', '동행 형태'],
              ].map(([key, label]) => `<label><span>${label} 가중치</span><input type="number" name="weight_${key}" min="0" max="100" value="${Number(weights[key] || 0)}"></label>`).join('')}
            </div>
            <div class="project-field project-span-2"><span>추천에 사용할 광주자원</span></div>
            ${current.resources.map((resource) => `
              <div class="project-resource-edit project-span-2">
                <label class="project-resource-toggle">
                  <input type="checkbox" name="resourceIds" value="${esc(resource.id)}" ${selected.has(String(resource.id)) ? 'checked' : ''}>
                  <span><b>${esc(resource.name)}</b><small>${esc(resource.verificationStatus)} · 공식 출처 고정</small></span>
                </label>
                <textarea name="resourceSummary_${esc(resource.id)}" rows="2" placeholder="학생 눈높이의 쉬운 설명">${esc(overrides[resource.id]?.summary || resource.summary)}</textarea>
                <input name="resourceCareers_${esc(resource.id)}" value="${esc(asArray(overrides[resource.id]?.careers || resource.careers).join(', '))}" placeholder="관련 직업을 쉼표로 구분">
              </div>`).join('')}
            ${textArea(esc, 'improvementList', '테스트 후 개선 목록', data.improvementList, '테스트에서 발견한 개선사항을 적어 보세요.', 4)}
          </div>
          <div class="project-builder-actions">
            <button class="btn btn-primary" type="button" id="save-app-config">웹앱 설정 저장</button>
            <button class="btn btn-ghost" type="button" id="save-app-version">임시 버전 만들기</button>
          </div>
        </div>
        <aside class="project-preview-panel">
          <div class="project-phone">
            <div class="project-phone-top"></div>
            <div class="project-phone-screen" style="--project-color:${esc(config.primaryColor || '#6D3AF2')}">
              <span class="project-phone-chip">광주 지역자원 추천</span>
              <h3 id="builder-preview-name">${esc(config.serviceName || '광주픽')}</h3>
              <p id="builder-preview-tagline">${esc(config.tagline || '')}</p>
              <div class="project-phone-cards"><i></i><i></i><i></i></div>
              <button id="builder-preview-button">${esc(config.startButton || '내게 맞는 광주 찾기')}</button>
            </div>
          </div>
          <button class="btn btn-ghost project-preview-run" type="button" id="open-recommend-test">추천 작동 테스트</button>
        </aside>
      </div>
      <div class="project-feedback-form">
        <h3>다른 팀 사용자 테스트</h3>
        <div class="project-form-grid">
          ${textArea(esc, 'feedbackLiked', '좋았던 점', '', '', 3)}
          ${textArea(esc, 'feedbackConfusing', '헷갈린 점', '', '', 3)}
          ${textArea(esc, 'feedbackSuggestion', '개선 제안', '', '', 3)}
        </div>
        <button class="btn btn-ghost" type="button" id="save-user-feedback">테스트 의견 저장</button>
      </div>`;
  }

  function sessionSix(current, data) {
    const published = current.published;
    return `
      <div class="project-lesson-intro">최종 설정을 배포하고 팀별 URL·QR을 만든 뒤 피칭과 개인 진로성찰을 기록합니다.</div>
      <div class="project-publish-card">
        <div>
          <span>우리 팀 최종 웹앱</span>
          <h3>${esc(current.config.serviceName || '광주픽')}</h3>
          <p>${esc(current.config.tagline || '')}</p>
          ${published ? `<a target="_blank" rel="noopener" href="#/p/${esc(published.slug)}">${esc(`${location.origin}/#/p/${published.slug}`)}</a>` : '<em>아직 배포하지 않았습니다.</em>'}
        </div>
        ${published ? `<img src="/api/public/apps/${esc(published.slug)}/qr" alt="배포 앱 QR 코드">` : ''}
        <button class="btn btn-primary" type="button" id="publish-project-app">${published ? '새 버전 다시 배포' : '최종 버전 배포'}</button>
      </div>
      <div class="project-form-grid">
        ${textArea(esc, 'pitchSummary', '팀 피칭 요약', data.pitchSummary, '문제, 해결방법, 추천기준을 중심으로 정리하세요.', 4)}
        ${textArea(esc, 'reflectionLearning', '내가 새롭게 알게 된 점', data.reflectionLearning, '', 4)}
        ${textArea(esc, 'reflectionRole', '나와 잘 맞았던 역할과 이유', data.reflectionRole, '', 4)}
        ${textArea(esc, 'reflectionNext', '다음에 더 해보고 싶은 일', data.reflectionNext, '', 4)}
        ${selectField(esc, 'postCareerInterest', '진로활동 관심도', ['1 낮음', '2', '3 보통', '4', '5 높음'], data.postCareerInterest)}
        ${selectField(esc, 'postAiConfidence', 'AI 정보 검증 자신감', ['1 낮음', '2', '3 보통', '4', '5 높음'], data.postAiConfidence)}
      </div>`;
  }

  function collectSessionData(no, form) {
    const raw = formDataObject(form);
    if (no === 1) {
      return {
        interestedResources: asArray(raw.interestedResources),
        aiGapMemo: raw.aiGapMemo || '',
        careerInterest: raw.careerInterest || '',
        aiConfidence: raw.aiConfidence || '',
      };
    }
    if (no === 4) {
      return {
        appPlan: {
          personalRole: raw.personalRole || '',
          roleReason: raw.roleReason || '',
          teamRoleTable: raw.teamRoleTable || '',
          serviceName: raw.serviceName || '',
          tagline: raw.tagline || '',
          slogan: raw.slogan || '',
          primaryColor: raw.primaryColor || '#6D3AF2',
          selectedResources: asArray(raw.selectedResources),
          weights: {
            interest: Number(raw.weight_interest || 0),
            time: Number(raw.weight_time || 0),
            budget: Number(raw.weight_budget || 0),
            activity: Number(raw.weight_activity || 0),
            companion: Number(raw.weight_companion || 0),
          },
        },
      };
    }
    if (no === 5) return { improvementList: raw.improvementList || '' };
    return raw;
  }

  function collectAppConfig(form, current) {
    const raw = formDataObject(form);
    const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 20);
    const resourceOverrides = {};
    for (const resource of current.resources) {
      resourceOverrides[resource.id] = {
        summary: raw[`resourceSummary_${resource.id}`] || resource.summary,
        careers: split(raw[`resourceCareers_${resource.id}`]),
      };
    }
    return {
      serviceName: raw.serviceName || '광주픽',
      tagline: raw.tagline || '',
      slogan: raw.slogan || '',
      startButton: raw.startButton || '내게 맞는 광주 찾기',
      primaryColor: raw.primaryColor || '#6D3AF2',
      accentColor: raw.accentColor || '#FFCC4D',
      questions: {
        interest: raw.question_interest || '',
        time: raw.question_time || '',
        budget: raw.question_budget || '',
        activity: raw.question_activity || '',
        companion: raw.question_companion || '',
      },
      options: {
        interest: split(raw.options_interest),
        time: split(raw.options_time),
        budget: split(raw.options_budget),
        activity: split(raw.options_activity),
        companion: split(raw.options_companion),
      },
      weights: {
        interest: Number(raw.weight_interest || 0),
        time: Number(raw.weight_time || 0),
        budget: Number(raw.weight_budget || 0),
        activity: Number(raw.weight_activity || 0),
        companion: Number(raw.weight_companion || 0),
      },
      resourceIds: asArray(raw.resourceIds),
      resourceOverrides,
    };
  }

  function openRecommendTest(current) {
    const config = current.config || {};
    const options = config.options || {};
    const back = openModal(`
      <form id="project-recommend-test">
        <h3>추천 작동 테스트</h3>
        <div class="m-sub">입력 조건을 바꾸면 등록된 광주자원 안에서 추천 3곳이 달라집니다.</div>
        <div class="project-form-grid">
          ${selectField(esc, 'interest', '관심사', asArray(options.interest))}
          ${selectField(esc, 'time', '가능한 시간', asArray(options.time))}
          ${selectField(esc, 'budget', '예산', asArray(options.budget))}
          ${selectField(esc, 'activity', '활동 유형', asArray(options.activity))}
          ${selectField(esc, 'companion', '동행 형태', asArray(options.companion))}
        </div>
        <div id="project-test-results"></div>
        <div class="m-actions">
          <button class="btn btn-ghost" type="button" data-close>닫기</button>
          <button class="btn btn-primary" type="submit">추천 3곳 보기</button>
        </div>
      </form>`);
    back.querySelector('[data-close]').onclick = () => back.remove();
    back.querySelector('#project-recommend-test').onsubmit = async (event) => {
      event.preventDefault();
      const result = await api('POST', '/api/project/current/recommend', { input: formDataObject(event.currentTarget) });
      back.querySelector('#project-test-results').innerHTML = `<div class="project-test-results">
        ${result.results.map((resource, index) => `<article><i>${index + 1}</i><div><b>${esc(resource.name)}</b><p>${esc(resource.reason)}</p><small>점수 ${resource.score} · ${esc(resource.verificationStatus)}</small></div></article>`).join('')}
      </div>`;
    };
  }

  route(/^#\/project$/, async () => {
    if (!state.me?.projectTeamId) {
      location.hash = '#/decks';
      return;
    }
    const current = await api('GET', '/api/project/current');
    const visible = Array.isArray(current.project.sessionVisibility) ? current.project.sessionVisibility : [];
    let target = 1;
    for (let no = 1; no <= 6; no += 1) {
      if (no <= current.project.currentSession && visible[no - 1] !== false) target = no;
    }
    location.hash = `#/project/${target}`;
  });

  route(/^#\/project\/([1-6])$/, async (sessionNoText) => {
    if (!state.me?.projectTeamId) {
      location.hash = '#/decks';
      return;
    }
    const no = Number(sessionNoText);
    const current = await api('GET', '/api/project/current');
    const visible = Array.isArray(current.project.sessionVisibility) ? current.project.sessionVisibility : [];
    const open = no <= current.project.currentSession && visible[no - 1] !== false;
    if (!open) {
      shell('AI 프로젝트', `
        ${projectStepper(current, no)}
        <div class="project-locked">
          <span class="project-lock-icon">${icon('lock')}</span><h2>${no}차시는 아직 열리지 않았습니다.</h2>
          <p>선생님이 차시를 공개하면 이어서 작업할 수 있습니다.</p>
          <a class="btn btn-primary" href="#/project">현재 차시로 돌아가기</a>
        </div>`);
      return;
    }
    const progress = current.progress.find((row) => Number(row.session_no) === no) || {};
    const data = progress.draft_data || progress.confirmed_data || {};
    const bodies = [
      () => sessionOne(current, data),
      () => sessionTwo(data),
      () => sessionThree(data),
      () => sessionFour(current, data),
      () => sessionFive(current, data),
      () => sessionSix(current, data),
    ];
    shell('AI 프로젝트', `
      <div class="student-project-head">
        <div>
          <span>${esc(current.project.title)} · ${esc(current.team.name)}</span>
          <h2>${no}차시. ${esc(SESSION_TITLES[no - 1])}</h2>
        </div>
        <span class="badge ${progress.status === '확정' ? 'green' : progress.status === '작성 중' ? 'blue' : 'gray'}">${esc(progress.status || '미시작')}</span>
      </div>
      ${projectStepper(current, no)}
      <form id="project-session-form" class="student-project-form">
        ${bodies[no - 1]()}
        <div class="project-save-bar">
          <div>
            <span>${progress.last_saved_at ? `마지막 저장 ${esc(dateText(progress.last_saved_at))}` : '아직 저장하지 않았습니다.'}</span>
            <small>개인정보로 보이는 내용은 서버에서 저장을 막습니다.</small>
          </div>
          <button class="btn btn-ghost" type="button" data-session-action="draft">임시저장</button>
          <button class="btn btn-primary" type="button" data-session-action="confirm">차시 결과 확정</button>
        </div>
      </form>`);
    const form = document.getElementById('project-session-form');
    document.querySelectorAll('[data-session-action]').forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          const payload = collectSessionData(no, form);
          if (no === 5) {
            const config = collectAppConfig(form, current);
            await api('PATCH', '/api/project/current/app-config', { config });
          }
          if (no === 1 && button.dataset.sessionAction === 'confirm') {
            await api('POST', '/api/project/current/assessment/pre', {
              answers: { careerInterest: payload.careerInterest, aiConfidence: payload.aiConfidence },
            });
          }
          if (no === 6 && button.dataset.sessionAction === 'confirm') {
            await api('POST', '/api/project/current/reflection', {
              reflection: {
                learning: payload.reflectionLearning,
                role: payload.reflectionRole,
                next: payload.reflectionNext,
              },
            });
            await api('POST', '/api/project/current/assessment/post', {
              answers: {
                careerInterest: payload.postCareerInterest,
                aiConfidence: payload.postAiConfidence,
              },
            });
          }
          await api('PATCH', `/api/project/current/sessions/${no}`, {
            action: button.dataset.sessionAction,
            data: payload,
          });
          toast(button.dataset.sessionAction === 'confirm' ? '차시 결과를 확정했습니다.' : '임시저장했습니다.');
          navigate();
        } catch (error) {
          toast(error.message, true);
          button.disabled = false;
        }
      };
    });
    if (no === 5) {
      const livePreview = () => {
        const raw = formDataObject(form);
        document.getElementById('builder-preview-name').textContent = raw.serviceName || '광주픽';
        document.getElementById('builder-preview-tagline').textContent = raw.tagline || '';
        document.getElementById('builder-preview-button').textContent = raw.startButton || '시작하기';
        const screen = document.querySelector('.project-phone-screen');
        if (screen) screen.style.setProperty('--project-color', raw.primaryColor || '#6D3AF2');
      };
      form.querySelectorAll('input, textarea, select').forEach((input) => input.addEventListener('input', livePreview));
      document.getElementById('save-app-config').onclick = async () => {
        try {
          const config = collectAppConfig(form, current);
          await api('PATCH', '/api/project/current/app-config', { config });
          toast('웹앱 설정을 저장했습니다.');
        } catch (error) { toast(error.message, true); }
      };
      document.getElementById('save-app-version').onclick = async () => {
        try {
          const config = collectAppConfig(form, current);
          await api('PATCH', '/api/project/current/app-config', { config });
          const result = await api('POST', '/api/project/current/version', { notes: form.elements.improvementList.value });
          toast(`임시 버전 v${result.versionNo}을 만들었습니다.`);
        } catch (error) { toast(error.message, true); }
      };
      document.getElementById('open-recommend-test').onclick = async () => {
        try {
          const config = collectAppConfig(form, current);
          const saved = await api('PATCH', '/api/project/current/app-config', { config });
          openRecommendTest({ ...current, config: saved.config });
        } catch (error) { toast(error.message, true); }
      };
      document.getElementById('save-user-feedback').onclick = async () => {
        try {
          const raw = formDataObject(form);
          await api('POST', '/api/project/current/feedback', {
            liked: raw.feedbackLiked,
            confusing: raw.feedbackConfusing,
            suggestion: raw.feedbackSuggestion,
          });
          toast('사용자 테스트 의견을 저장했습니다.');
          form.elements.feedbackLiked.value = '';
          form.elements.feedbackConfusing.value = '';
          form.elements.feedbackSuggestion.value = '';
        } catch (error) { toast(error.message, true); }
      };
    }
    if (no === 6) {
      document.getElementById('publish-project-app').onclick = async () => {
        const button = document.getElementById('publish-project-app');
        button.disabled = true;
        try {
          const result = await api('POST', '/api/project/current/publish', { notes: '6차시 최종 배포' });
          toast(`최종 버전 v${result.versionNo}을 배포했습니다.`);
          navigate();
        } catch (error) {
          toast(error.message, true);
          button.disabled = false;
        }
      };
    }
  });

  function publicOptionSelect(config, key) {
    const options = asArray(config.options?.[key]);
    return `<label><span>${esc(config.questions?.[key] || key)}</span>
      <select name="${esc(key)}" required>
        <option value="">선택하세요</option>
        ${options.map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join('')}
      </select></label>`;
  }

  route(/^#\/p\/([a-z0-9-]+)$/, async (slug) => {
    const data = await api('GET', `/api/public/apps/${encodeURIComponent(slug)}`);
    const config = data.app.config || {};
    const overrides = config.resourceOverrides || {};
    const resourceMap = new Map(data.resources.map((resource) => [String(resource.id), resource]));
    let results = [];
    let selectedId = null;
    const render = (view = 'home') => {
      const selected = selectedId ? resourceMap.get(String(selectedId)) : null;
      $app.innerHTML = `
        <div class="public-project-app" style="--project-color:${esc(config.primaryColor || '#6D3AF2')};--project-accent:${esc(config.accentColor || '#FFCC4D')}">
          <header>
            <a href="#/p/${esc(slug)}" data-public-home><b>${esc(config.serviceName || '광주픽')}</b><span>${esc(data.app.teamName)}</span></a>
            <span>검증된 광주 지역자원</span>
          </header>
          <main>
            ${view === 'home' ? `
              <section class="public-project-hero">
                <span>광주 문화·진로 추천 웹앱</span>
                <h1>${esc(config.serviceName || '광주픽')}</h1>
                <p>${esc(config.tagline || '')}</p>
                <button data-public-start>${esc(config.startButton || '내게 맞는 광주 찾기')}</button>
                <div class="public-project-trust"><b>등록된 공식 자원만 추천</b><b>AI 없이도 정상 작동</b><b>개인정보 수집 없음</b></div>
              </section>` : view === 'input' ? `
              <section class="public-project-input">
                <div class="public-project-title"><span>조건 입력</span><h1>어떤 광주 활동을 찾고 있나요?</h1><p>다섯 가지 조건을 선택하면 잘 맞는 자원 3곳을 추천합니다.</p></div>
                <form id="public-recommend-form">
                  ${publicOptionSelect(config, 'interest')}
                  ${publicOptionSelect(config, 'time')}
                  ${publicOptionSelect(config, 'budget')}
                  ${publicOptionSelect(config, 'activity')}
                  ${publicOptionSelect(config, 'companion')}
                  <button type="submit">추천 결과 보기</button>
                </form>
              </section>` : view === 'results' ? `
              <section class="public-project-results">
                <div class="public-project-title"><span>추천 결과</span><h1>${esc(config.resultTitle || '나에게 맞는 광주 자원 3곳')}</h1><p>점수는 팀이 설정한 기준과 입력 조건의 일치 정도입니다.</p></div>
                <div class="public-result-grid">
                  ${results.map((resource, index) => {
                    const override = overrides[resource.id] || {};
                    return `<article>
                      <i>${index + 1}</i>
                      <div class="public-result-score">${resource.score}점</div>
                      <h2>${esc(resource.name)}</h2>
                      <p>${esc(override.summary || resource.summary)}</p>
                      <div class="public-result-tags">${asArray(resource.tags).slice(0, 3).map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>
                      <strong>${esc(resource.reason)}</strong>
                      <button data-resource-detail="${esc(resource.id)}">자세히 보기</button>
                    </article>`;
                  }).join('')}
                </div>
                <button class="public-retry" data-public-start>${esc(config.retryButton || '조건 바꿔 다시 추천')}</button>
              </section>` : `
              <section class="public-resource-detail">
                <button class="public-back" data-back-results>← 추천 결과</button>
                <div class="public-resource-detail-card">
                  <span>${esc(selected?.verificationStatus || '')}</span>
                  <h1>${esc(selected?.name || '')}</h1>
                  <p>${esc(overrides[selected?.id]?.summary || selected?.summary || '')}</p>
                  <div class="public-resource-columns">
                    <div><h3>주요 활동과 특징</h3><ul>${asArray(selected?.highlights).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
                    <div><h3>관련 미래직업</h3><ul>${asArray(overrides[selected?.id]?.careers || selected?.careers).map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>
                  </div>
                  <div class="public-source-box">
                    <div><b>공식 출처</b><span>자료 확인일 ${esc(selected?.checkedAt || '확인 필요')}</span></div>
                    <a href="${esc(selected?.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">공식자료 확인</a>
                  </div>
                  <p class="public-caution">운영시간·요금·예약 여부는 변동될 수 있습니다. 방문 전에 반드시 공식자료를 다시 확인하세요.</p>
                </div>
              </section>`}
          </main>
          <footer><b>${esc(config.slogan || '')}</b><span>${esc(data.app.projectTitle)} · ${esc(data.app.teamName)}</span></footer>
        </div>`;
      document.querySelectorAll('[data-public-home]').forEach((button) => { button.onclick = (event) => { event.preventDefault(); render('home'); }; });
      document.querySelectorAll('[data-public-start]').forEach((button) => { button.onclick = () => render('input'); });
      document.querySelectorAll('[data-resource-detail]').forEach((button) => {
        button.onclick = () => { selectedId = button.dataset.resourceDetail; render('detail'); };
      });
      const back = document.querySelector('[data-back-results]');
      if (back) back.onclick = () => render('results');
      const form = document.getElementById('public-recommend-form');
      if (form) {
        form.onsubmit = async (event) => {
          event.preventDefault();
          const button = form.querySelector('button[type="submit"]');
          button.disabled = true;
          try {
            const response = await api('POST', `/api/public/apps/${encodeURIComponent(slug)}/recommend`, { input: formDataObject(form) });
            results = response.results;
            for (const resource of results) resourceMap.set(String(resource.id), resource);
            render('results');
          } catch (error) {
            button.disabled = false;
            toast(error.message, true);
          }
        };
      }
    };
    render('home');
  });
}
