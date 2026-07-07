'use strict';

/* =====================================================
 * AI 온라인 플랫폼 관리자 — SPA
 * 대시보드 / 웹앱(PPT) 관리 / 사용자 권한 / 시간표 접근 / 보안 / 로그
 * ===================================================== */

const $app = document.getElementById('app');

const state = {
  me: null,          // 로그인 사용자
  access: null,      // 시간제 접근 상태
  settings: null,    // 보안 설정
};

const ROLE_LABELS = { superadmin: '슈퍼관리자', admin: '관리자', instructor: '강사', student: '학생' };
const ROLE_LEVEL = { student: 0, instructor: 1, admin: 2, superadmin: 3 };
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function level(role) { return ROLE_LEVEL[role] ?? -1; }
function isStaff() { return state.me && level(state.me.role) >= 1; }
function isAdmin() { return state.me && level(state.me.role) >= 2; }

/* ---------------- API ---------------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    state.me = null;
    location.hash = '#/login';
    throw new Error(data.error || '로그인이 필요합니다.');
  }
  if (res.status === 403 && data.error === 'time_blocked') {
    state.access = data.access;
    renderBlocked();
    throw new Error(data.message);
  }
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

/* ---------------- 슬라이드 본문 렌더링 (마크다운 최소 문법) ---------------- */
function renderBody(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  let html = '';
  let listOpen = false;
  const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const img = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/.exec(line);
    if (img) { closeList(); html += `<img src="${esc(img[2])}" alt="${esc(img[1])}">`; continue; }
    if (line.startsWith('## ')) { closeList(); html += `<h2>${inline(line.slice(3))}</h2>`; continue; }
    if (line.startsWith('- ')) { if (!listOpen) { html += '<ul>'; listOpen = true; } html += `<li>${inline(line.slice(2))}</li>`; continue; }
    if (line === '') { closeList(); continue; }
    closeList(); html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

function slideHtml(slide, { watermark } = {}) {
  return `
    <div class="slide-frame ${esc(slide.bg)} ${slide.align === 'center' ? 'align-center' : ''}">
      ${slide.title ? `<h1>${esc(slide.title)}</h1>` : ''}
      ${renderBody(slide.body)}
      ${watermark ? watermarkDiv() : ''}
    </div>`;
}

/* ---------------- 워터마크 ---------------- */
function watermarkDiv() {
  const u = state.me;
  const now = new Date();
  const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const label = `${u.name} (${u.username}) ${stamp}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220">
    <text x="20" y="120" font-size="15" fill="rgba(128,128,128,0.22)" transform="rotate(-25 180 110)" font-family="sans-serif">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
  </svg>`;
  return `<div class="watermark" style="background-image:url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}')"></div>`;
}

/* ---------------- 보호 모드 (복제·캡처 억제) ----------------
 * - 학생: 로그인 중 항상 적용
 * - 강사/관리자: 프레젠테이션 중에만 적용
 * 완전한 차단은 웹 기술로 불가능하며(스마트폰 촬영 등) 억제와 기록이 목적. */
const Protect = {
  presenting: false,
  reported: new Set(),

  shouldBlock() {
    if (!state.me || !state.settings) return false;
    if (this.presenting) return true;
    return state.me.role === 'student';
  },
  copyBlockOn() { return this.shouldBlock() && state.settings.block_copy; },
  captureBlockOn() { return this.shouldBlock() && state.settings.block_capture; },

  report(type, detail) {
    const key = `${type}:${Math.floor(Date.now() / 5000)}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    api('POST', '/api/report-capture', { type, detail }).catch(() => {});
  },

  flashBlackout(message) {
    const el = document.createElement('div');
    el.className = 'blackout';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  },

  init() {
    for (const ev of ['contextmenu', 'copy', 'cut', 'dragstart', 'selectstart']) {
      document.addEventListener(ev, (e) => {
        // 편집 입력창은 예외
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !this.presenting) return;
        if (this.copyBlockOn()) {
          e.preventDefault();
          if (ev === 'copy' || ev === 'contextmenu') this.report(ev, location.hash);
        }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (!this.shouldBlock()) return;
      const k = e.key;
      const combo = (e.ctrlKey || e.metaKey);
      const blocked =
        (this.captureBlockOn() && (k === 'F12' || (combo && e.shiftKey && ['I', 'J', 'C', 'S'].includes(k.toUpperCase())))) ||
        (combo && ['p', 's', 'u'].includes(k.toLowerCase())) ||
        (this.copyBlockOn() && combo && !(e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) && ['c', 'x', 'a'].includes(k.toLowerCase()));
      if (blocked) {
        e.preventDefault();
        this.report('shortcut', `${combo ? 'Ctrl+' : ''}${k}`);
      }
    });
    // PrintScreen은 preventDefault가 불가능 → 감지 즉시 화면 가림 + 클립보드 덮어쓰기 + 기록
    document.addEventListener('keyup', (e) => {
      if (e.key === 'PrintScreen' && this.captureBlockOn()) {
        try { navigator.clipboard.writeText('화면 캡처가 금지된 콘텐츠입니다.'); } catch {}
        this.flashBlackout('화면 캡처가 감지되어 기록되었습니다.');
        this.report('printscreen', location.hash);
      }
    });
    window.addEventListener('beforeprint', () => {
      if (this.shouldBlock()) this.report('print', location.hash);
    });
    // 프레젠테이션 중 창 이탈 시 블랙아웃 (녹화·캡처 도구 전환 억제)
    const onLeave = () => {
      if (!this.presenting || !this.captureBlockOn()) return;
      if (document.getElementById('leave-blackout')) return;
      const el = document.createElement('div');
      el.className = 'blackout';
      el.id = 'leave-blackout';
      el.innerHTML = '화면이 보호를 위해 가려졌습니다.<br>이 창을 다시 클릭하면 이어서 볼 수 있습니다.';
      document.body.appendChild(el);
    };
    const onBack = () => document.getElementById('leave-blackout')?.remove();
    window.addEventListener('blur', onLeave);
    document.addEventListener('visibilitychange', () => (document.hidden ? onLeave() : onBack()));
    window.addEventListener('focus', onBack);
    document.addEventListener('click', onBack);
  },

  apply() {
    document.body.classList.toggle('no-select', this.copyBlockOn());
  },
};
Protect.init();

/* ---------------- 라우터 ---------------- */
const routes = [];
function route(pattern, fn) { routes.push({ pattern, fn }); }

async function navigate() {
  const hash = location.hash || '#/';
  if (!state.me && hash !== '#/login') { location.hash = '#/login'; return; }
  if (state.me && state.me.mustChangePassword && hash !== '#/password' && hash !== '#/login') {
    location.hash = '#/password';
    return;
  }
  // 학생 시간제 차단 (비밀번호 변경은 허용)
  if (state.me && state.me.role === 'student' && state.access && !state.access.allowed && hash !== '#/password' && hash !== '#/login') {
    renderBlocked();
    return;
  }
  for (const r of routes) {
    const m = r.pattern.exec(hash);
    if (m) {
      try { await r.fn(...m.slice(1)); } catch (e) { console.error(e); }
      Protect.apply();
      return;
    }
  }
  location.hash = state.me ? (isStaff() ? '#/' : '#/decks') : '#/login';
}
window.addEventListener('hashchange', navigate);

/* ---------------- 공통 셸 ---------------- */
function menuItems() {
  const r = state.me.role;
  const items = [];
  if (level(r) >= 1) items.push(['#/', '📊', '대시보드']);
  items.push(['#/decks', '📑', level(r) >= 1 ? '웹앱/PPT 관리' : '내 학습 자료']);
  if (level(r) >= 1) items.push(['#/users', '👥', level(r) >= 2 ? '사용자·권한 관리' : '학생 관리']);
  items.push(['#/schedules', '🗓️', level(r) >= 2 ? '시간표 접근 설정' : '접근 시간표']);
  if (level(r) >= 2) items.push(['#/security', '🛡️', '보안 설정']);
  if (level(r) >= 2) items.push(['#/logs', '🧾', '접속 기록']);
  items.push(['#/password', '🔑', '비밀번호 변경']);
  return items;
}

function shell(title, contentHtml) {
  const u = state.me;
  const hash = location.hash || '#/';
  const acc = state.access;
  $app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">AI 온라인 플랫폼 관리자</div>
        <nav>
          ${menuItems().map(([href, ic, label]) =>
            `<a href="${href}" class="${hash === href ? 'active' : ''}"><span>${ic}</span>${label}</a>`).join('')}
        </nav>
        <div class="foot">
          현재 시각: ${acc ? `${esc(acc.now.dayName)}요일 ${esc(acc.now.time)}` : '-'}<br>
          접근 상태: ${acc && acc.allowed ? '<span class="ok">허용 시간</span>' : '<span class="bad">차단 시간</span>'}<br>
          <span class="muted small">${acc ? esc(acc.now.timezone) : ''}</span>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <h1>${esc(title)}</h1>
          <div class="user-chip">
            <div class="who">
              <div class="nm">${esc(u.name)}</div>
              <div class="rl">${esc(u.roleLabel)}</div>
            </div>
            <div class="avatar">${esc(u.name.slice(0, 1))}</div>
            <button class="btn-ghost" id="btn-logout">로그아웃</button>
          </div>
        </div>
        <div class="content">${contentHtml}</div>
      </div>
    </div>`;
  document.getElementById('btn-logout').onclick = async () => {
    await api('POST', '/api/logout').catch(() => {});
    state.me = null;
    location.hash = '#/login';
  };
}

/* ---------------- 로그인 ---------------- */
route(/^#\/login$/, () => {
  $app.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="login-form">
        <div class="logo">AI 온라인 플랫폼 관리자</div>
        <div class="sub">진로교육 웹앱 · 접근 관리 시스템</div>
        <label>아이디</label>
        <input name="username" autocomplete="username" required />
        <label>비밀번호</label>
        <input name="password" type="password" autocomplete="current-password" required />
        <button class="btn-primary" type="submit">로그인</button>
        <div class="login-error" id="login-error"></div>
      </form>
    </div>`;
  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const data = await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      state.me = data.user;
      state.access = data.access;
      state.settings = data.settings;
      location.hash = data.user.mustChangePassword ? '#/password' : (level(data.user.role) >= 1 ? '#/' : '#/decks');
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
    }
  };
});

/* ---------------- 학생 차단 화면 ---------------- */
function renderBlocked() {
  const acc = state.access;
  shell('접근 제한', `
    <div class="blocked-wrap">
      <div class="big">⏰</div>
      <h2>지금은 접근이 허용된 시간이 아닙니다</h2>
      <p>현재 ${esc(acc.now.dayName)}요일 ${esc(acc.now.time)} (${esc(acc.now.timezone)}) — 아래 허용 시간에 다시 접속해 주세요.</p>
      <div class="card" style="text-align:left">${scheduleGridHtml(acc.windows, false)}</div>
      <p class="mt small muted">이 화면은 30초마다 자동으로 새로고침됩니다.</p>
    </div>`);
  setTimeout(refreshMe, 30000);
}

async function refreshMe() {
  try {
    const data = await api('GET', '/api/me');
    state.me = data.user;
    state.access = data.access;
    state.settings = data.settings;
    navigate();
  } catch {}
}

/* ---------------- 시간표 그리드 ---------------- */
function scheduleGridHtml(windows, withControls) {
  const byDay = {};
  for (const w of windows) (byDay[w.day_of_week] ||= []).push(w);
  return `<div class="sched-grid">
    ${DAY_ORDER.map((d) => `
      <div class="day-h">${DAY_NAMES[d]}</div>
      <div class="day-c">
        ${(byDay[d] || []).map((w) => `
          <span class="win-chip ${w.deck_id ? 'deck' : ''} ${w.enabled ? '' : 'off'}">
            ${esc(w.start_time)}~${esc(w.end_time)} ${w.deck_id ? esc(w.deck_title || '웹앱') : '전체 허용'}
            ${withControls ? `<button class="btn-sm" data-tgl="${w.id}" data-en="${w.enabled ? 0 : 1}" style="margin-left:6px">${w.enabled ? '끄기' : '켜기'}</button><button class="btn-sm danger" data-del-sched="${w.id}">삭제</button>` : ''}
          </span>`).join('') || '<span class="no-win">차단 (허용 시간 없음)</span>'}
      </div>`).join('')}
  </div>`;
}

/* ---------------- 대시보드 ---------------- */
route(/^#\/$/, async () => {
  if (!isStaff()) { location.hash = '#/decks'; return; }
  const [dash, sched] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/schedules')]);
  state.access = sched;
  const s = dash.stats;
  const roleFlow = [
    ['#7c3aed', '🛡️', '슈퍼관리자', ['시스템 전체 관리', '관리자 계정 부여', '보안 정책 관리']],
    ['#2563eb', '🏛️', '관리자', ['강사/학생 관리', '시간표 접근 설정', '접속 기록 열람']],
    ['#16a34a', '🧑‍🏫', '강사', ['웹앱/PPT 제작·운영', '학생 계정 부여', '수업 진행']],
    ['#f59e0b', '🎓', '학생', ['허용 시간에만 접속', '자료 열람(캡처 제한)', '수업 참여']],
  ];
  shell('대시보드', `
    <div class="grid stats">
      <div class="card stat"><div class="ic b">📑</div><div><div class="lb">총 웹앱 수</div><div class="num">${s.decks}<span class="small muted"> 개 (공개 ${s.publishedDecks})</span></div></div></div>
      <div class="card stat"><div class="ic g">🧑‍🏫</div><div><div class="lb">활성 강사</div><div class="num">${s.instructors}<span class="small muted"> 명</span></div></div></div>
      <div class="card stat"><div class="ic v">🎓</div><div><div class="lb">활성 학생</div><div class="num">${s.students}<span class="small muted"> 명</span></div></div></div>
      <div class="card stat"><div class="ic o">🕘</div><div><div class="lb">오늘 접속 / 차단</div><div class="num">${s.todayLogins}<span class="small muted"> / ${s.todayBlocked}건</span></div></div></div>
    </div>
    <div class="grid two">
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card">
          <h2>역할 및 권한 체계</h2>
          <div class="roles-flow">
            ${roleFlow.map(([color, ic, name, items], i) => `
              ${i > 0 ? '<div class="role-arrow">›</div>' : ''}
              <div class="role-box">
                <div class="rc" style="background:${color}">${ic}</div>
                <div class="rn">${name}</div>
                <div class="rd">${items.map((t) => `· ${t}`).join('<br>')}</div>
              </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <h2>시간표 기반 접근 제어 <span class="badge green">접근 허용</span> <span class="badge blue">웹앱별 허용</span> <span class="badge gray">차단</span></h2>
          ${scheduleGridHtml(sched.windows, false)}
          ${isAdmin() ? '<div class="mt"><a href="#/schedules" class="btn-sm">시간표 설정으로 이동 →</a></div>' : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        ${isAdmin() ? `
        <div class="card">
          <h2>보안 설정</h2>
          <div id="sec-toggles">${securityTogglesHtml()}</div>
        </div>` : ''}
        <div class="card">
          <h2>최근 접속 로그 <span class="badge amber">캡처 시도 누적 ${s.captureAttempts}건</span></h2>
          ${logListHtml(dash.recentLogs)}
          ${isAdmin() ? '<div class="mt"><a href="#/logs" class="btn-sm">전체 보기 →</a></div>' : ''}
        </div>
      </div>
    </div>`);
  bindSecurityToggles();
});

/* ---------------- 보안 설정 ---------------- */
const SEC_ITEMS = [
  ['block_capture', '화면 캡처 방지', 'PrintScreen 감지·개발자도구 차단·화면 이탈 시 가림'],
  ['block_copy', '복제/복사 차단', '우클릭·텍스트 선택·복사/붙여넣기·드래그 차단'],
  ['watermark', '워터마크 표시', '열람자 이름·아이디·시각을 슬라이드 위에 표시'],
  ['single_session', '동시접속 제한 (1개 기기)', '학생 계정은 마지막으로 로그인한 기기만 유지'],
];

function securityTogglesHtml() {
  const st = state.settings || {};
  return SEC_ITEMS.map(([key, label, desc]) => `
    <div class="sec-row">
      <div><div class="sl">${label}</div><div class="sd">${desc}</div></div>
      <label class="toggle"><input type="checkbox" data-setting="${key}" ${st[key] ? 'checked' : ''}><span class="tr"></span></label>
    </div>`).join('');
}

function bindSecurityToggles() {
  document.querySelectorAll('input[data-setting]').forEach((el) => {
    el.onchange = async () => {
      const data = await api('PATCH', '/api/settings', { [el.dataset.setting]: el.checked });
      state.settings = data.settings;
    };
  });
}

route(/^#\/security$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const data = await api('GET', '/api/settings');
  state.settings = data.settings;
  shell('보안 설정', `
    <div class="card" style="max-width:640px">
      <h2>콘텐츠 보호 정책</h2>
      ${securityTogglesHtml()}
      <p class="mt small muted">
        ※ 웹 기술 특성상 캡처를 100% 차단할 수는 없습니다(스마트폰 촬영, OS 수준 캡처 등).
        본 기능은 워터마크·차단·시도 기록을 통한 <b>억제와 추적</b>이 목적이며, 모든 시도는 접속 기록에 남습니다.
      </p>
    </div>`);
  bindSecurityToggles();
});

/* ---------------- 웹앱(덱) 목록 ---------------- */
route(/^#\/decks$/, async () => {
  const data = await api('GET', '/api/decks');
  if (state.me.role === 'student') {
    shell('내 학습 자료', `
      <div class="deck-cards">
        ${data.decks.map((d) => `
          <div class="deck-card">
            <div class="thumb">${esc(d.title)}</div>
            <div class="body">
              <div class="desc">${esc(d.description) || '설명 없음'}</div>
              <div class="meta">
                <span class="small muted">슬라이드 ${d.slideCount}장 · ${esc(d.ownerName)} 강사</span>
                ${d.accessibleNow
                  ? `<a href="#/view/${d.id}" class="btn-sm primary">학습 시작</a>`
                  : '<span class="badge red">지금은 차단 시간</span>'}
              </div>
            </div>
          </div>`).join('') || '<p class="muted">아직 공개된 학습 자료가 없습니다.</p>'}
      </div>`);
    return;
  }
  shell('웹앱/PPT 관리', `
    <div class="page-head">
      <div><div class="desc">PPT처럼 발표할 수 있는 웹앱(슬라이드 덱)을 만들고 관리합니다.</div></div>
      <button class="btn-primary" id="btn-new-deck">+ 새 웹앱 만들기</button>
    </div>
    <div class="card tbl-scroll">
      <table class="tbl">
        <thead><tr><th>웹앱명</th><th>담당</th><th>슬라이드</th><th>상태</th><th>수정일</th><th style="width:280px">작업</th></tr></thead>
        <tbody>
          ${data.decks.map((d) => `
            <tr>
              <td><b>${esc(d.title)}</b><div class="small muted">${esc(d.description)}</div></td>
              <td>${esc(d.ownerName)}</td>
              <td>${d.slideCount}장</td>
              <td>${d.published ? '<span class="badge green">공개 중</span>' : '<span class="badge gray">비공개</span>'}</td>
              <td class="small muted">${esc(d.updated_at)}</td>
              <td>
                <a class="btn-sm primary" href="#/view/${d.id}">재생</a>
                <a class="btn-sm" href="#/decks/${d.id}/edit">편집</a>
                <button class="btn-sm" data-pub="${d.id}" data-val="${d.published ? 0 : 1}">${d.published ? '비공개로' : '공개하기'}</button>
                <button class="btn-sm danger" data-del="${d.id}">삭제</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">웹앱이 없습니다. 새로 만들어 보세요.</td></tr>'}
        </tbody>
      </table>
    </div>`);
  document.getElementById('btn-new-deck').onclick = async () => {
    const title = prompt('웹앱(PPT) 제목을 입력하세요.');
    if (!title) return;
    const r = await api('POST', '/api/decks', { title, description: '' });
    location.hash = `#/decks/${r.id}/edit`;
  };
  document.querySelectorAll('[data-pub]').forEach((b) => {
    b.onclick = async () => {
      await api('PATCH', `/api/decks/${b.dataset.pub}`, { published: b.dataset.val === '1' });
      navigate();
    };
  });
  document.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 웹앱과 모든 슬라이드를 삭제할까요?')) return;
      await api('DELETE', `/api/decks/${b.dataset.del}`);
      navigate();
    };
  });
});

/* ---------------- 뷰어 + 프레젠테이션 ---------------- */
route(/^#\/view\/(\d+)$/, async (id) => {
  const data = await api('GET', `/api/decks/${id}`);
  const wm = state.settings && state.settings.watermark;
  let idx = 0;
  shell(data.deck.title, `
    <div class="page-head">
      <div class="desc">${esc(data.deck.description)} · 슬라이드 ${data.slides.length}장</div>
      <div>
        ${data.canEdit ? `<a class="btn-sm" href="#/decks/${id}/edit">편집</a>` : ''}
        <button class="btn-primary" id="btn-present">▶ 전체화면 발표</button>
      </div>
    </div>
    <div style="max-width:960px">
      <div id="viewer-slide">${data.slides.length ? slideHtml(data.slides[0], { watermark: wm }) : '<p class="muted">슬라이드가 없습니다.</p>'}</div>
      <div class="mt" style="display:flex;gap:8px;align-items:center">
        <button class="btn-ghost" id="prev">← 이전</button>
        <span id="counter" class="muted">1 / ${data.slides.length}</span>
        <button class="btn-ghost" id="next">다음 →</button>
      </div>
    </div>`);
  const show = (i) => {
    idx = Math.max(0, Math.min(data.slides.length - 1, i));
    document.getElementById('viewer-slide').innerHTML = slideHtml(data.slides[idx], { watermark: wm });
    document.getElementById('counter').textContent = `${idx + 1} / ${data.slides.length}`;
  };
  document.getElementById('prev').onclick = () => show(idx - 1);
  document.getElementById('next').onclick = () => show(idx + 1);
  document.getElementById('btn-present').onclick = () => present(data.slides, data.deck.title);
});

function present(slides, title) {
  if (!slides.length) return alert('슬라이드가 없습니다.');
  Protect.presenting = true;
  Protect.apply();
  let idx = 0;
  const wm = state.settings && state.settings.watermark;
  const overlay = document.createElement('div');
  overlay.className = 'present-overlay no-select';
  const render = () => {
    overlay.innerHTML = `
      <div class="stage">${slideHtml(slides[idx], { watermark: wm })}</div>
      <div class="progress"><div class="fill" style="width:${((idx + 1) / slides.length) * 100}%"></div></div>
      <div class="present-bar">
        <span>${esc(title)}</span>
        <span>${idx + 1} / ${slides.length} — 방향키·클릭으로 이동</span>
        <button id="exit-present">종료 (ESC)</button>
      </div>`;
    overlay.querySelector('#exit-present').onclick = exit;
    overlay.querySelector('.stage').onclick = (e) => {
      // 왼쪽 1/4 클릭 → 이전, 나머지 → 다음
      if (e.offsetX < overlay.clientWidth / 4) go(-1); else go(1);
    };
  };
  const go = (d) => { idx = Math.max(0, Math.min(slides.length - 1, idx + d)); render(); };
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Escape') exit();
  };
  const exit = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    Protect.presenting = false;
    Protect.apply();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.requestFullscreen?.().catch(() => {});
  render();
}

/* ---------------- 편집기 ---------------- */
route(/^#\/decks\/(\d+)\/edit$/, async (id) => {
  if (!isStaff()) { location.hash = '#/decks'; return; }
  const data = await api('GET', `/api/decks/${id}`);
  if (!data.canEdit) { location.hash = '#/decks'; return; }
  let slides = data.slides;
  let sel = 0;

  const listHtml = () => slides.map((s, i) => `
    <div class="slide-item ${i === sel ? 'active' : ''}" data-i="${i}">
      <span class="n">${i + 1}</span><span class="t">${esc(s.title) || '(제목 없음)'}</span>
    </div>`).join('');

  shell(`편집: ${data.deck.title}`, `
    <div class="page-head">
      <div>
        <input id="deck-title" value="${esc(data.deck.title)}" style="font-size:16px;font-weight:800;border:1px solid var(--line);border-radius:9px;padding:8px 12px;width:320px">
        <input id="deck-desc" value="${esc(data.deck.description)}" placeholder="설명" style="border:1px solid var(--line);border-radius:9px;padding:8px 12px;width:280px">
        <button class="btn-sm" id="save-deck">덱 정보 저장</button>
      </div>
      <div>
        <span class="badge ${data.deck.published ? 'green' : 'gray'}">${data.deck.published ? '공개 중' : '비공개'}</span>
        <a class="btn-sm primary" href="#/view/${id}">미리보기/발표</a>
      </div>
    </div>
    <div class="editor">
      <div>
        <div class="slide-list" id="slide-list">${listHtml()}</div>
        <div class="mt">
          <button class="btn-sm primary" id="add-slide">+ 슬라이드 추가</button>
          <button class="btn-sm" id="mv-up">↑</button>
          <button class="btn-sm" id="mv-dn">↓</button>
          <button class="btn-sm danger" id="del-slide">삭제</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card">
          <div class="form-grid">
            <div style="grid-column:1/-1"><label>슬라이드 제목</label><input id="s-title"></div>
            <div><label>테마</label>
              <select id="s-bg">
                <option value="theme-navy">네이비</option><option value="theme-white">화이트</option>
                <option value="theme-mint">민트</option><option value="theme-sunset">선셋</option>
                <option value="theme-violet">바이올렛</option><option value="theme-dark">다크</option>
              </select></div>
            <div><label>정렬</label>
              <select id="s-align"><option value="left">왼쪽</option><option value="center">가운데</option></select></div>
          </div>
          <div class="mt"><label class="small muted">본문 — <code>## 소제목</code>, <code>- 글머리</code>, <code>**굵게**</code>, <code>![설명](https://이미지주소)</code></label>
            <textarea id="s-body"></textarea></div>
          <div class="mt"><button class="btn-primary" id="save-slide">슬라이드 저장</button> <span class="msg" id="save-msg"></span></div>
        </div>
        <div><h2 class="small muted" style="margin-bottom:8px">미리보기</h2><div id="preview" style="max-width:760px"></div></div>
      </div>
    </div>`);

  const $ = (s) => document.querySelector(s);
  const loadForm = () => {
    const s = slides[sel];
    if (!s) return;
    $('#s-title').value = s.title;
    $('#s-body').value = s.body;
    $('#s-bg').value = s.bg;
    $('#s-align').value = s.align;
    updatePreview();
  };
  const updatePreview = () => {
    $('#preview').innerHTML = slideHtml({
      title: $('#s-title').value, body: $('#s-body').value, bg: $('#s-bg').value, align: $('#s-align').value,
    });
  };
  const refreshList = () => {
    $('#slide-list').innerHTML = listHtml();
    bindList();
  };
  const bindList = () => {
    document.querySelectorAll('.slide-item').forEach((el) => {
      el.onclick = () => { sel = Number(el.dataset.i); refreshList(); loadForm(); };
    });
  };
  bindList();
  loadForm();

  for (const sid of ['s-title', 's-body', 's-bg', 's-align']) $(`#${sid}`).addEventListener('input', updatePreview);

  $('#save-slide').onclick = async () => {
    const s = slides[sel];
    if (!s) return;
    Object.assign(s, { title: $('#s-title').value, body: $('#s-body').value, bg: $('#s-bg').value, align: $('#s-align').value });
    await api('PATCH', `/api/slides/${s.id}`, { title: s.title, body: s.body, bg: s.bg, align: s.align });
    $('#save-msg').textContent = '저장되었습니다.';
    $('#save-msg').className = 'msg ok';
    setTimeout(() => { $('#save-msg').textContent = ''; }, 1500);
    refreshList();
  };
  $('#save-deck').onclick = async () => {
    await api('PATCH', `/api/decks/${id}`, { title: $('#deck-title').value, description: $('#deck-desc').value });
    alert('덱 정보가 저장되었습니다.');
  };
  $('#add-slide').onclick = async () => {
    await api('POST', `/api/decks/${id}/slides`, {});
    const fresh = await api('GET', `/api/decks/${id}`);
    slides = fresh.slides;
    sel = slides.length - 1;
    refreshList(); loadForm();
  };
  $('#del-slide').onclick = async () => {
    const s = slides[sel];
    if (!s || !confirm('이 슬라이드를 삭제할까요?')) return;
    await api('DELETE', `/api/slides/${s.id}`);
    slides.splice(sel, 1);
    sel = Math.max(0, sel - 1);
    refreshList(); loadForm();
  };
  const move = async (d) => {
    const j = sel + d;
    if (j < 0 || j >= slides.length) return;
    [slides[sel], slides[j]] = [slides[j], slides[sel]];
    sel = j;
    await api('POST', `/api/decks/${id}/reorder`, { ids: slides.map((s) => s.id) });
    refreshList(); loadForm();
  };
  $('#mv-up').onclick = () => move(-1);
  $('#mv-dn').onclick = () => move(1);
});

/* ---------------- 사용자·권한 관리 ---------------- */
let userTab = 'all';
route(/^#\/users$/, async () => {
  if (!isStaff()) { location.hash = '#/decks'; return; }
  const data = await api('GET', '/api/users');
  const myLevel = level(state.me.role);
  const creatable = Object.keys(ROLE_LEVEL).filter((r) => ROLE_LEVEL[r] < myLevel).reverse();
  const tabs = [['all', '전체'], ...creatable.map((r) => [r, ROLE_LABELS[r]])];
  const list = data.users.filter((u) => userTab === 'all' || u.role === userTab);

  shell(myLevel >= 2 ? '사용자·권한 관리' : '학생 관리', `
    <div class="card" style="margin-bottom:16px">
      <h2>새 계정 만들기 <span class="small muted">— 자신보다 낮은 권한만 부여할 수 있습니다</span></h2>
      <form id="user-form" class="form-grid">
        <div><label>아이디</label><input name="username" required minlength="3"></div>
        <div><label>이름</label><input name="name" required></div>
        <div><label>역할(권한)</label>
          <select name="role">${creatable.map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join('')}</select></div>
        <div><label>초기 비밀번호 (8자 이상)</label><input name="password" type="text" required minlength="8"></div>
        <div><button class="btn-primary" type="submit" style="width:100%">계정 생성</button></div>
      </form>
      <div class="msg" id="user-msg"></div>
    </div>
    <div class="tabs">
      ${tabs.map(([k, label]) => `<button data-tab="${k}" class="${userTab === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div class="card tbl-scroll">
      <table class="tbl">
        <thead><tr><th>아이디</th><th>이름</th><th>역할</th><th>상태</th><th>생성일</th><th style="width:260px">작업</th></tr></thead>
        <tbody>
          ${list.map((u) => `
            <tr>
              <td><b>${esc(u.username)}</b></td>
              <td>${esc(u.name)}</td>
              <td><span class="badge blue">${esc(u.roleLabel)}</span></td>
              <td>${u.active ? '<span class="badge green">활성</span>' : '<span class="badge red">비활성</span>'}</td>
              <td class="small muted">${esc(u.createdAt)}</td>
              <td>
                ${u.id === state.me.id ? '<span class="small muted">본인 계정</span>' : `
                <button class="btn-sm" data-act="${u.id}" data-val="${u.active ? 0 : 1}">${u.active ? '비활성화' : '활성화'}</button>
                <button class="btn-sm" data-rpw="${u.id}">비번 초기화</button>
                ${myLevel >= 2 ? `<button class="btn-sm danger" data-udel="${u.id}">삭제</button>` : ''}`}
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">해당하는 사용자가 없습니다.</td></tr>'}
        </tbody>
      </table>
    </div>`);

  document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { userTab = b.dataset.tab; navigate(); }; });
  document.getElementById('user-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById('user-msg');
    try {
      await api('POST', '/api/users', {
        username: f.get('username'), name: f.get('name'), role: f.get('role'), password: f.get('password'),
      });
      msg.textContent = `계정이 생성되었습니다. 첫 로그인 시 비밀번호 변경이 요구됩니다.`;
      msg.className = 'msg ok';
      navigate();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
  document.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => { await api('PATCH', `/api/users/${b.dataset.act}`, { active: b.dataset.val === '1' }); navigate(); };
  });
  document.querySelectorAll('[data-rpw]').forEach((b) => {
    b.onclick = async () => {
      const pw = prompt('새 임시 비밀번호를 입력하세요 (8자 이상). 대상자는 첫 로그인 시 변경해야 합니다.');
      if (!pw) return;
      try { await api('POST', `/api/users/${b.dataset.rpw}/reset-password`, { password: pw }); alert('초기화되었습니다.'); }
      catch (err) { alert(err.message); }
    };
  });
  document.querySelectorAll('[data-udel]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 계정을 삭제할까요? 되돌릴 수 없습니다.')) return;
      await api('DELETE', `/api/users/${b.dataset.udel}`);
      navigate();
    };
  });
});

/* ---------------- 시간표 접근 설정 ---------------- */
route(/^#\/schedules$/, async () => {
  const data = await api('GET', '/api/schedules');
  state.access = data;
  const canEdit = isAdmin();
  let deckOptions = '';
  if (canEdit) {
    const decks = await api('GET', '/api/decks');
    deckOptions = decks.decks.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join('');
  }
  shell(canEdit ? '시간표 접근 설정' : '접근 시간표', `
    ${canEdit ? `
    <div class="card" style="margin-bottom:16px">
      <h2>허용 시간 추가 <span class="small muted">— 학생은 아래 시간에만 접속할 수 있습니다 (${esc(data.now.timezone)})</span></h2>
      <form id="sched-form" class="form-grid">
        <div><label>요일</label>
          <select name="day_of_week">${DAY_ORDER.map((d) => `<option value="${d}">${DAY_NAMES[d]}요일</option>`).join('')}</select></div>
        <div><label>시작</label><input name="start_time" type="time" value="09:00" required></div>
        <div><label>종료</label><input name="end_time" type="time" value="18:00" required></div>
        <div><label>대상</label>
          <select name="deck_id"><option value="">전체 웹앱</option>${deckOptions}</select></div>
        <div><button class="btn-primary" type="submit" style="width:100%">추가</button></div>
      </form>
      <div class="msg" id="sched-msg"></div>
    </div>` : ''}
    <div class="card">
      <h2>주간 접근 시간표 <span class="small muted">현재: ${esc(data.now.dayName)}요일 ${esc(data.now.time)} — ${data.allowed ? '<span class="badge green">접근 허용</span>' : '<span class="badge red">차단 시간</span>'}</span></h2>
      ${scheduleGridHtml(data.windows, canEdit)}
    </div>`);
  if (!canEdit) return;
  document.getElementById('sched-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById('sched-msg');
    try {
      await api('POST', '/api/schedules', {
        day_of_week: f.get('day_of_week'), start_time: f.get('start_time'),
        end_time: f.get('end_time'), deck_id: f.get('deck_id') || null,
      });
      navigate();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
  document.querySelectorAll('[data-tgl]').forEach((b) => {
    b.onclick = async () => { await api('PATCH', `/api/schedules/${b.dataset.tgl}`, { enabled: b.dataset.en === '1' }); navigate(); };
  });
  document.querySelectorAll('[data-del-sched]').forEach((b) => {
    b.onclick = async () => { await api('DELETE', `/api/schedules/${b.dataset.delSched}`); navigate(); };
  });
});

/* ---------------- 접속 기록 ---------------- */
const LOG_LABELS = {
  login: ['정상 접속', 'green'], login_failed: ['로그인 실패', 'red'], login_blocked: ['차단(비활성 계정)', 'red'],
  logout: ['로그아웃', 'gray'], time_blocked: ['허용 시간 외 차단', 'red'], capture_attempt: ['캡처/복제 시도', 'amber'],
  deck_viewed: ['자료 열람', 'blue'], user_created: ['계정 생성', 'blue'], user_updated: ['계정 수정', 'gray'],
  user_deleted: ['계정 삭제', 'red'], password_changed: ['비밀번호 변경', 'gray'], password_reset: ['비밀번호 초기화', 'amber'],
  schedule_created: ['시간표 추가', 'blue'], schedule_updated: ['시간표 수정', 'gray'], schedule_deleted: ['시간표 삭제', 'gray'],
  deck_created: ['웹앱 생성', 'blue'], deck_updated: ['웹앱 수정', 'gray'], deck_deleted: ['웹앱 삭제', 'red'],
  settings_updated: ['보안 설정 변경', 'amber'],
};

function logListHtml(logs) {
  return `<table class="tbl"><tbody>
    ${logs.map((l) => {
      const [label, color] = LOG_LABELS[l.action] || [l.action, 'gray'];
      return `<tr>
        <td><span class="badge ${color}">${esc(label)}</span></td>
        <td><b>${esc(l.username || '-')}</b><div class="small muted">${esc(l.detail)}</div></td>
        <td class="small muted" style="white-space:nowrap">${esc(l.created_at)}</td>
      </tr>`;
    }).join('') || '<tr><td class="muted">기록이 없습니다.</td></tr>'}
  </tbody></table>`;
}

route(/^#\/logs$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const data = await api('GET', '/api/logs');
  shell('접속 기록', `<div class="card tbl-scroll">${logListHtml(data.logs)}</div>`);
});

/* ---------------- 비밀번호 변경 ---------------- */
route(/^#\/password$/, async () => {
  shell('비밀번호 변경', `
    <div class="card" style="max-width:460px">
      ${state.me.mustChangePassword ? '<p class="msg err" style="margin-bottom:12px">보안을 위해 비밀번호를 변경해야 서비스를 이용할 수 있습니다.</p>' : ''}
      <form id="pw-form" class="form-grid" style="grid-template-columns:1fr">
        <div><label>현재 비밀번호</label><input name="current" type="password" required autocomplete="current-password"></div>
        <div><label>새 비밀번호 (8자 이상)</label><input name="next" type="password" required minlength="8" autocomplete="new-password"></div>
        <div><label>새 비밀번호 확인</label><input name="next2" type="password" required minlength="8" autocomplete="new-password"></div>
        <button class="btn-primary" type="submit">변경하기</button>
      </form>
      <div class="msg" id="pw-msg"></div>
    </div>`);
  document.getElementById('pw-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById('pw-msg');
    if (f.get('next') !== f.get('next2')) {
      msg.textContent = '새 비밀번호가 서로 다릅니다.';
      msg.className = 'msg err';
      return;
    }
    try {
      await api('POST', '/api/password', { current: f.get('current'), next: f.get('next') });
      state.me.mustChangePassword = false;
      msg.textContent = '변경되었습니다.';
      msg.className = 'msg ok';
      setTimeout(() => { location.hash = isStaff() ? '#/' : '#/decks'; }, 700);
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
});

/* ---------------- 부팅 ---------------- */
(async function boot() {
  try {
    const data = await api('GET', '/api/me');
    state.me = data.user;
    state.access = data.access;
    state.settings = data.settings;
  } catch { state.me = null; }
  if (!location.hash) location.hash = state.me ? (isStaff() ? '#/' : '#/decks') : '#/login';
  navigate();
  // 시간제 접근 상태 주기 갱신 (5분)
  setInterval(refreshMe, 5 * 60 * 1000);
})();
