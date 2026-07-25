'use strict';

/* =====================================================
 * AI 온라인 플랫폼 관리자 — SPA
 * SaaS형 관리자 대시보드: 권한 체계 / 시간표 접근 제어 / 웹앱 배정 / 보안 / 리포트
 * ===================================================== */

const $app = document.getElementById('app');

const state = {
  me: null,           // 로그인 사용자
  access: null,       // 시간제 접근 상태
  settings: null,     // 보안 설정
  classSession: null, // 게스트(입장 코드) 수업 정보
  mustAgree: false,   // 계약·보안 동의 필요 여부
  dash: null,         // 대시보드 캐시 (알림용)
  dashAt: 0,
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

/* ---------------- 아이콘 (Feather 스타일 인라인 SVG) ---------------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
  decks: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  creditCard: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  chevRight: '<polyline points="9 18 15 12 9 6"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  cameraOff: '<line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  mouse: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/>',
  droplet: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  smartphone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
};
function icon(name) {
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------------- API ---------------- */
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/api/login')) {
    state.me = null;
    if (!/^#\/p\/[a-z0-9-]+$/.test(location.hash || '')) location.hash = '#/login';
    throw new Error(data.error || '로그인이 필요합니다.');
  }
  if (res.status === 403 && data.error === 'time_blocked') {
    state.access = data.access;
    renderBlocked();
    throw new Error(data.message);
  }
  if (res.status === 403 && data.error === 'agreement_required') {
    state.mustAgree = true;
    if (location.hash !== '#/agreement') location.hash = '#/agreement';
    throw new Error(data.message);
  }
  if (!res.ok) {
    const err = new Error(data.error || '요청에 실패했습니다.');
    err.data = data;
    throw err;
  }
  return data;
}

/* ---------------- 토스트 / 모달 ---------------- */
function toast(message, warn = false) {
  let zone = document.getElementById('toast-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'toast-zone';
    document.body.appendChild(zone);
  }
  const el = document.createElement('div');
  el.className = `toast ${warn ? 'warn' : ''}`;
  el.textContent = message;
  zone.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function openModal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}

/* ---------------- 슬라이드 렌더링 (마크다운 최소 문법) ---------------- */
// 동영상 임베드: 유튜브(watch/shorts/youtu.be) 또는 https mp4/webm 직접 링크
function videoEmbed(url) {
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,20})/.exec(url);
  if (yt) {
    return `<div class="video-box"><iframe src="https://www.youtube.com/embed/${esc(yt[1])}?rel=0&modestbranding=1"
      title="영상" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer"></iframe></div>`;
  }
  // https mp4/webm 직접 링크 또는 플랫폼에 업로드한 동영상 자산(/api/assets/N)
  if (/^https:\/\/[^\s<>"']+\.(mp4|webm|m4v)(\?[^\s<>"']*)?$/i.test(url) || /^\/api\/assets\/\d+$/.test(url)) {
    return `<div class="video-box"><video controls src="${esc(url)}" controlslist="nodownload" disablepictureinpicture oncontextmenu="return false"></video></div>`;
  }
  return `<p>${esc(url)}</p>`;
}

function renderBodyMd(text) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  let html = '';
  let listOpen = false;
  const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    const vid = /^!video\(((?:https?:\/\/|\/api\/assets\/)[^)\s]+)\)$/.exec(line);
    if (vid) { closeList(); html += videoEmbed(vid[1]); continue; }
    const img = /^!\[([^\]]*)\]\(((?:https?:\/\/|\/api\/assets\/)[^)\s]+)\)$/.exec(line);
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
  const bodyTrim = String(slide.body || '').trim();
  const hasTitle = !!String(slide.title || '').trim();
  // 동영상 한 개만 있는 슬라이드는 검은 배경에 꽉 차게 재생 (슬라이드 사이 삽입 영상)
  const vidOnly = /^!video\(((?:https?:\/\/|\/api\/assets\/)[^)\s]+)\)$/.exec(bodyTrim);
  if (vidOnly && !hasTitle) {
    return `
      <div class="slide-frame video-slide">
        ${videoEmbed(vidOnly[1])}
        ${watermark ? watermarkDiv() : ''}
      </div>`;
  }
  // 이미지 한 장만 있는 슬라이드(PPT 변환)는 여백 없이 원본 그대로 표시
  const only = /^!\[[^\]]*\]\(((?:https?:\/\/|\/api\/assets\/)[^)\s]+)\)$/.exec(bodyTrim);
  if (only && !hasTitle) {
    return `
      <div class="slide-frame img-slide">
        <img class="full" src="${esc(only[1])}" alt="슬라이드">
        ${watermark ? watermarkDiv() : ''}
      </div>`;
  }
  // 업로드한 배경 이미지 (bg:<자산ID>:<light|dark>)
  const bgm = /^bg:(\d+):(light|dark)$/.exec(String(slide.bg || ''));
  const cls = bgm ? `custom-bg tone-${bgm[2]}` : esc(slide.bg);
  const style = bgm ? ` style="background-image:url('/api/assets/${bgm[1]}')"` : '';
  return `
    <div class="slide-frame ${cls} ${slide.align === 'center' ? 'align-center' : ''}"${style}>
      ${slide.title ? `<h1>${esc(slide.title)}</h1>` : ''}
      ${renderBodyMd(slide.body)}
      ${watermark ? watermarkDiv() : ''}
    </div>`;
}

// 워터마크: 보안 설정의 내용 템플릿({이름}/{아이디}/{시각})·배치·진하기를 반영
function watermarkLabel() {
  const u = state.me;
  const now = new Date();
  const stamp = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const tpl = (state.settings && state.settings.wm_text) || '{이름} ({아이디}) {시각}';
  return tpl.replace(/\{이름\}/g, u.name).replace(/\{아이디\}/g, u.username).replace(/\{시각\}/g, stamp);
}

function watermarkDiv() {
  const st = state.settings || {};
  const label = watermarkLabel();
  const opacity = { light: 0.11, medium: 0.22, strong: 0.38 }[st.wm_opacity] || 0.22;
  const pos = st.wm_position || 'tile';
  if (pos === 'tile') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="220">
      <text x="20" y="120" font-size="15" fill="rgba(128,128,128,${opacity})" transform="rotate(-25 180 110)" font-family="sans-serif">${label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
    </svg>`;
    return `<div class="watermark" style="background-image:url('data:image/svg+xml;utf8,${encodeURIComponent(svg)}')"></div>`;
  }
  const place = {
    'corner-br': 'right:16px;bottom:12px;',
    'corner-tl': 'left:16px;top:12px;',
    'center': 'left:50%;top:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:1.7em;',
  }[pos] || 'right:16px;bottom:12px;';
  return `<div class="watermark"><span style="position:absolute;${place}color:rgba(128,128,128,${opacity});font-weight:700;font-size:.95em;white-space:nowrap;">${esc(label)}</span></div>`;
}

/* ---------------- 보호 모드 (복제·캡처 억제) ----------------
 * 학생: 항상 적용 / 강사·관리자: 발표 중에만 적용.
 * 완전 차단은 불가능하므로 차단 강화 + 워터마크 추적 + 로그 기록이 목적. */
const Protect = {
  presenting: false,
  reported: new Set(),
  devtoolsTimer: null,

  shouldBlock() {
    if (!state.me || !state.settings) return false;
    if (this.presenting) return true;
    return state.me.role === 'student';
  },
  on(key) { return this.shouldBlock() && state.settings[key]; },

  report(type, detail) {
    const dedup = `${type}:${Math.floor(Date.now() / 5000)}`;
    if (this.reported.has(dedup)) return;
    this.reported.add(dedup);
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
    document.addEventListener('contextmenu', (e) => {
      if (this.on('block_rightclick')) {
        e.preventDefault();
        this.report('contextmenu', location.hash);
      }
    });
    for (const ev of ['copy', 'cut', 'dragstart', 'selectstart']) {
      document.addEventListener(ev, (e) => {
        if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && !this.presenting) return;
        if (this.on('block_copy')) {
          e.preventDefault();
          if (ev === 'copy') this.report('copy', location.hash);
        }
      });
    }
    document.addEventListener('keydown', (e) => {
      if (!this.shouldBlock()) return;
      const k = e.key;
      const combo = (e.ctrlKey || e.metaKey);
      const inField = e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      const blocked =
        (this.on('block_capture') && (k === 'F12' || (combo && e.shiftKey && ['I', 'J', 'C', 'S'].includes(k.toUpperCase())))) ||
        (combo && ['p', 's', 'u'].includes(k.toLowerCase())) ||
        (this.on('block_copy') && combo && !inField && ['c', 'x', 'a'].includes(k.toLowerCase()));
      if (blocked) {
        e.preventDefault();
        this.report('shortcut', `${combo ? 'Ctrl+' : ''}${k}`);
      }
    });
    // PrintScreen은 preventDefault 불가 → 즉시 화면 가림 + 클립보드 덮어쓰기 + 기록
    document.addEventListener('keyup', (e) => {
      if (e.key === 'PrintScreen' && this.on('block_capture')) {
        try { navigator.clipboard.writeText('화면 캡처가 금지된 콘텐츠입니다.'); } catch {}
        this.flashBlackout('화면 캡처 시도가 감지되어 기록되었습니다.');
        this.report('printscreen', location.hash);
      }
    });
    window.addEventListener('beforeprint', () => {
      if (this.shouldBlock()) this.report('print', location.hash);
    });
    // 발표 중 창 이탈 시 블랙아웃
    const onLeave = () => {
      if (!this.presenting || !this.on('block_capture')) return;
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

    // 개발자도구 감지(휴리스틱): 창 외곽-내부 크기 차이로 도킹된 devtools 추정
    this.devtoolsTimer = setInterval(() => {
      if (!this.on('devtools_detect')) return;
      const w = window.outerWidth - window.innerWidth;
      const h = window.outerHeight - window.innerHeight;
      if (w > 220 || h > 240) {
        const dedup = `devtools:${Math.floor(Date.now() / 300000)}`;
        if (this.reported.has(dedup)) return;
        this.reported.add(dedup);
        api('POST', '/api/report-capture', { type: 'devtools', detail: location.hash }).catch(() => {});
        toast('개발자도구 사용이 감지되어 기록되었습니다.', true);
      }
    }, 2500);
  },

  apply() {
    document.body.classList.toggle('no-select', this.on('block_copy'));
  },
};
Protect.init();

/* ---------------- 라이브 발표 따라가기 (게스트 학생) ----------------
 * 3초 간격 폴링: 강사가 라이브를 시작하면 자동으로 라이브 화면에 진입하고,
 * 슬라이드가 넘어가면 함께 넘어가며, 종료되면 자료 목록으로 돌아온다. */
const Live = {
  timer: null,
  last: null,
  start() {
    if (this.timer || !state.me || !state.me.isGuest || !state.classSession) return;
    this.timer = setInterval(() => this.tick(), 3000);
    this.tick();
  },
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.last = null;
  },
  async tick() {
    if (!state.me || !state.me.isGuest) { this.stop(); return; }
    try {
      const d = await api('GET', `/api/class-sessions/${state.classSession.id}/live`);
      this.last = d.live;
      const onLive = location.hash === '#/live';
      if (d.live && !onLive) { location.hash = '#/live'; return; }
      if (!d.live && onLive) {
        toast('라이브 발표가 종료되었습니다.');
        location.hash = '#/decks';
        return;
      }
      if (d.live && onLive && window.__liveUpdate) window.__liveUpdate(d.live);
      // 라이브가 아닐 때는 자료 잠금/해제 변화를 감지해 목록 갱신
      if (!d.live && window.__deckRefresh) window.__deckRefresh();
    } catch {}
  },
};

/* ---------------- 라우터 ---------------- */
const routes = [];
function route(pattern, fn) { routes.push({ pattern, fn }); }

let presentExit = null; // 발표 모드 정리 함수 (라우팅 이동 시 잔여 오버레이 방지)

async function navigate() {
  if (presentExit) presentExit();
  window.__liveUpdate = null;
  window.__deckRefresh = null;
  document.body.classList.remove('allow-print'); // 내보내기 화면 밖에서는 인쇄 차단 유지
  const hash = location.hash || '#/';
  const isPublicProjectApp = /^#\/p\/[a-z0-9-]+$/.test(hash);
  if (!state.me && hash !== '#/login' && !isPublicProjectApp) { location.hash = '#/login'; return; }
  if (state.me && state.me.mustChangePassword && hash !== '#/password' && hash !== '#/login') {
    location.hash = '#/password';
    return;
  }
  // 계약·보안 동의 강제 (강사·관리자)
  if (state.me && state.mustAgree && !['#/agreement', '#/login', '#/password'].includes(hash)) {
    location.hash = '#/agreement';
    return;
  }
  if (state.me && state.me.role === 'student' && state.access && !state.access.allowed
      && !['#/password', '#/login', '#/settings'].includes(hash)) {
    renderBlocked();
    return;
  }
  for (const r of routes) {
    const m = r.pattern.exec(hash);
    if (m) {
      try { await r.fn(...m.slice(1).map((v) => (v === undefined ? v : decodeURIComponent(v)))); }
      catch (e) { console.error(e); }
      Protect.apply();
      return;
    }
  }
  location.hash = state.me ? (isStaff() ? '#/' : '#/decks') : '#/login';
}
window.addEventListener('hashchange', navigate);

/* ---------------- 공통 컴포넌트 ---------------- */
const DECK_STATUS = {
  live: ['공개 중', 'green'],
  scheduled: ['예약', 'blue'],
  expired: ['만료', 'amber'],
  private: ['비공개', 'gray'],
};
function deckStatusBadge(d) {
  const [label, color] = DECK_STATUS[d.status] || DECK_STATUS.private;
  return `<span class="badge ${color}">${label}</span>`;
}
function periodText(d) {
  if (!d.access_start && !d.access_end) return '상시';
  return `${d.access_start || '…'} ~ ${d.access_end || '…'}`;
}
// 요금 유형 배지 (🆓 무료 / 💳 API 유료)
function costBadge(d) {
  if (d.costType === 'api_paid') {
    const prov = d.apiProvider ? ` ${esc(d.apiProvider)}` : '';
    const unit = d.unitCost ? ` · ${Number(d.unitCost).toLocaleString()}원/회` : '';
    return `<span class="badge amber plain" title="API 유료 — 사용량만큼 과금">💳 API 유료${prov}${unit}</span>`;
  }
  return '<span class="badge green plain">🆓 무료</span>';
}

const LOG_LABELS = {
  login: ['정상 접속', 'green'], login_failed: ['로그인 실패', 'red'], login_blocked: ['차단 (비활성 계정)', 'red'],
  logout: ['로그아웃', 'gray'], time_blocked: ['허용 시간 외 차단', 'red'], ip_blocked: ['차단 (IP 미허용)', 'red'],
  capture_attempt: ['보안 경고: 캡처/복제 시도', 'amber'], multi_session: ['보안 경고: 다중 접속 시도', 'amber'],
  otp_failed: ['2단계 인증 실패', 'amber'], otp_enrolled: ['2단계 인증 등록', 'blue'],
  deck_viewed: ['자료 열람', 'blue'], user_created: ['계정 생성', 'blue'], user_updated: ['계정 수정', 'gray'],
  user_deleted: ['계정 삭제', 'red'], password_changed: ['비밀번호 변경', 'gray'], password_reset: ['비밀번호 초기화', 'amber'],
  schedule_created: ['시간표 추가', 'blue'], schedule_updated: ['시간표 수정', 'gray'], schedule_deleted: ['시간표 삭제', 'gray'],
  deck_created: ['웹앱 생성', 'blue'], deck_updated: ['웹앱 수정', 'gray'], deck_deleted: ['웹앱 삭제', 'red'],
  settings_updated: ['보안 설정 변경', 'amber'],
  guest_joined: ['수업 입장 (코드)', 'green'], join_failed: ['입장 코드 오류', 'amber'],
  session_created: ['수업 코드 생성', 'blue'], session_ended: ['수업 종료', 'gray'], session_deleted: ['수업 삭제', 'gray'],
  live_started: ['라이브 발표 시작', 'blue'], live_ended: ['라이브 발표 종료', 'gray'],
};
function browserOf(ua) {
  if (!ua) return '-';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  return '기타';
}
function logListHtml(logs) {
  if (!logs.length) return '<div class="empty-note">기록이 없습니다.</div>';
  return `<div class="log-list">
    ${logs.map((l) => {
      const [label, color] = LOG_LABELS[l.action] || [l.action, 'gray'];
      return `<div class="log-item">
        <div class="li-main">
          <div class="li-top"><span class="badge ${color}">${esc(label)}</span><span class="li-who">${esc(l.username || '알 수 없음')}</span></div>
          ${l.detail ? `<div class="li-det">${esc(l.detail)}</div>` : ''}
        </div>
        <div class="li-meta">${esc(l.created_at)}<br>${l.ip ? `${esc(l.ip)} · ${esc(browserOf(l.ua))}` : ''}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------------- 셸 (사이드바 + 헤더) ---------------- */
function menuGroups() {
  const r = state.me.role;
  if (state.me.isGuest) {
    if (state.me.projectTeamId) {
      return [['프로젝트', [['#/project', 'briefcase', 'AI 프로젝트']]]];
    }
    return [['수업', [['#/decks', 'decks', '수업 자료']]]];
  }
  if (r === 'student') {
    return [['메뉴', [
      ['#/decks', 'decks', '내 학습 자료'],
      ['#/schedules', 'calendar', '접근 시간표'],
      ['#/settings', 'sliders', '설정'],
    ]]];
  }
  if (r === 'instructor') {
    return [
      ['메인', [
        ['#/', 'dashboard', '대시보드'],
        ['#/my-courses', 'layers', '내 과정'],
        ['#/decks', 'decks', '웹앱/PPT 관리'],
        ['#/sessions', 'hash', '수업 입장 코드'],
        ['#/projects', 'briefcase', 'AI 프로젝트'],
      ]],
      ['사용자', [['#/students', 'users', '학생 관리']]],
      ['운영', [
        ['#/settings', 'sliders', '설정'],
      ]],
    ];
  }
  return [
    ['메인', [
      ['#/', 'dashboard', '대시보드'],
      ['#/decks', 'decks', '웹앱/PPT 관리'],
      ['#/courses', 'layers', '과정·강사배정'],
      ['#/sessions', 'hash', '수업 입장 코드'],
      ['#/projects', 'briefcase', 'AI 프로젝트'],
    ]],
    ['사용자', [
      ['#/permissions', 'shield', '권한 관리'],
      ['#/instructors', 'userCheck', '강사 관리'],
      ['#/students', 'users', '학생 관리'],
    ]],
    ['운영', [
      ['#/schedules', 'calendar', '시간표 접근 설정'],
      ['#/security', 'lock', '보안 설정'],
      ['#/logs', 'fileText', '접속 기록'],
      ['#/report', 'chart', '리포트'],
      ['#/billing', 'creditCard', '종량 집계'],
      ['#/settlement', 'receipt', '정산(청구 배분)'],
      ...(r === 'superadmin' ? [
        ['#/deletions', 'trash', '삭제 요청 승인'],
        ['#/contract', 'fileText', '계약 관리'],
      ] : []),
      ['#/settings', 'sliders', '설정'],
    ]],
  ];
}

function shell(title, contentHtml) {
  const u = state.me;
  const hash = (location.hash || '#/').split('/').slice(0, 2).join('/');
  const acc = state.access;
  const notifCount = state.dash ? state.dash.stats.warnings : 0;
  $app.innerHTML = `
    <div class="shell" id="shell">
      <div class="side-overlay" id="side-overlay"></div>
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">AI</div>
          <div><div class="bt">AI 온라인 플랫폼</div><div class="bs">진로교육 관리 시스템</div></div>
        </div>
        <nav>
          ${menuGroups().map(([label, items]) => `
            <div class="nav-label">${label}</div>
            ${items.map(([href, ic, text]) =>
              `<a href="${href}" class="${hash === href || (href === '#/' && (location.hash || '#/') === '#/') ? 'active' : ''}">${icon(ic)}${text}</a>`).join('')}
          `).join('')}
        </nav>
        <div class="side-foot">
          ${state.me.isGuest && state.classSession ? `
            ${icon('hash')} 수업: <b>${esc(state.classSession.title)}</b><br>
            종료: ${esc(new Date(state.classSession.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))}<br>
            <span class="tz">수업 종료 시 자동 로그아웃됩니다</span>
          ` : `
            ${icon('clock')} ${acc ? `${esc(acc.now.dayName)}요일 ${esc(acc.now.time)}` : '-'}<br>
            접근 상태: ${acc && acc.allowed ? '<span class="ok">허용 시간</span>' : '<span class="bad">차단 시간</span>'}<br>
            <span class="tz">${acc ? esc(acc.now.timezone) : ''}</span>
          `}
        </div>
      </aside>
      <div class="main">
        <header class="header">
          <button class="hamburger" id="btn-hamburger" aria-label="메뉴">${icon('menu')}</button>
          <div class="page-title">${esc(title)}</div>
          <div class="search-box">
            ${icon('search')}
            <input id="global-search" placeholder="웹앱, 강사, 학생, 로그 검색" autocomplete="off">
          </div>
          ${isStaff() ? `<button class="icon-btn" id="btn-notif" aria-label="알림">${icon('bell')}${notifCount ? `<span class="dot">${notifCount > 99 ? '99+' : notifCount}</span>` : ''}</button>` : ''}
          <button class="icon-btn" id="btn-help" aria-label="도움말">${icon('help')}</button>
          <div class="profile-chip">
            <div class="who"><div class="nm">${esc(u.name)}</div><div class="rl">${esc(u.roleLabel)}${u.className ? ` · ${esc(u.className)}` : ''}</div></div>
            <div class="avatar">${esc(u.name.slice(0, 1))}</div>
            <button class="icon-btn" id="btn-logout" title="로그아웃">${icon('logout')}</button>
          </div>
        </header>
        <div class="content">${contentHtml}</div>
      </div>
    </div>`;

  document.getElementById('btn-logout').onclick = async () => {
    await api('POST', '/api/logout').catch(() => {});
    state.me = null;
    state.dash = null;
    Live.stop();
    location.hash = '#/login';
  };
  const shellEl = document.getElementById('shell');
  document.getElementById('btn-hamburger').onclick = () => shellEl.classList.toggle('side-open');
  document.getElementById('side-overlay').onclick = () => shellEl.classList.remove('side-open');
  document.getElementById('global-search').onkeydown = (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      location.hash = `#/search/${encodeURIComponent(e.target.value.trim())}`;
    }
  };
  document.getElementById('btn-help').onclick = () => {
    openModal(`
      <h3>도움말</h3>
      <div class="m-sub">AI 온라인 플랫폼 관리자 사용 안내</div>
      <div style="font-size:13px;line-height:2">
        · <b>웹앱/PPT 관리</b>에서 슬라이드 웹앱을 만들고 반·기간을 배정합니다.<br>
        · <b>시간표 접근 설정</b>의 허용 시간에만 학생이 접속할 수 있습니다.<br>
        · <b>보안 설정</b>에서 캡처 방지 강화·워터마크 추적을 켜고 끕니다.<br>
        · 모든 접속·차단·보안 이벤트는 <b>접속 기록</b>에 남습니다.
      </div>
      <div class="m-actions"><button class="btn btn-primary" id="m-close">확인</button></div>`)
      .querySelector('#m-close').onclick = (e) => e.target.closest('.modal-back').remove();
  };
  const btnNotif = document.getElementById('btn-notif');
  if (btnNotif) {
    btnNotif.onclick = async () => {
      const existing = document.getElementById('notif-panel');
      if (existing) { existing.remove(); return; }
      await fetchDash(true).catch(() => {});
      const alerts = state.dash ? state.dash.alerts : [];
      const panel = document.createElement('div');
      panel.className = 'notif-panel';
      panel.id = 'notif-panel';
      panel.innerHTML = `
        <div class="np-head">보안 알림 <span class="sub" style="font-weight:500;color:var(--text-3)">최근 24시간 ${state.dash ? state.dash.stats.warnings : 0}건</span></div>
        ${alerts.length ? alerts.map((l) => {
          const [label, color] = LOG_LABELS[l.action] || [l.action, 'gray'];
          return `<div class="np-item"><span class="badge ${color}">${esc(label)}</span>
            <div><b>${esc(l.username || '알 수 없음')}</b> <span class="muted">${esc(l.detail).slice(0, 40)}</span>
            <div class="t">${esc(l.created_at)}</div></div></div>`;
        }).join('') : '<div class="np-item">알림이 없습니다.</div>'}`;
      document.querySelector('.main').appendChild(panel);
      const close = (e) => {
        if (!panel.contains(e.target) && e.target !== btnNotif && !btnNotif.contains(e.target)) {
          panel.remove();
          document.removeEventListener('mousedown', close);
        }
      };
      document.addEventListener('mousedown', close);
    };
  }
  // 알림 수 갱신 (비동기)
  if (isStaff() && !state.dash) fetchDash().then(() => {
    const cnt = state.dash?.stats.warnings || 0;
    if (cnt && btnNotif && !btnNotif.querySelector('.dot')) {
      btnNotif.insertAdjacentHTML('beforeend', `<span class="dot">${cnt > 99 ? '99+' : cnt}</span>`);
    }
  }).catch(() => {});
}

async function fetchDash(force = false) {
  if (!isStaff()) return null;
  if (!force && state.dash && Date.now() - state.dashAt < 60000) return state.dash;
  state.dash = await api('GET', '/api/dashboard');
  state.dashAt = Date.now();
  return state.dash;
}

/* ---------------- 로그인 ---------------- */
route(/^#\/login$/, () => {
  let tab = 'join'; // 'join' (수업 입장 코드) | 'account' (계정 로그인)
  let otpMode = null; // null | 'otp' | 'setup'
  let secret = '';
  let joinCode = '';
  let joinInfo = null;
  let joinInfoTimer = null;
  const render = (errMsg = '') => {
    $app.innerHTML = `
      <div class="login-wrap">
        <form class="login-card" id="login-form">
          <div class="lmark">AI</div>
          <div class="logo">AI 온라인 플랫폼 관리자</div>
          <div class="sub">진로교육 웹앱 · 권한 및 접근 관리 시스템</div>
          <div class="tabs" style="margin-bottom:4px">
            <button type="button" data-ltab="join" class="${tab === 'join' ? 'active' : ''}">수업 참여</button>
            <button type="button" data-ltab="account" class="${tab === 'account' ? 'active' : ''}">계정 로그인</button>
          </div>
          ${tab === 'join' ? `
            <label>입장 코드 (6자리)</label>
            <input class="input" id="join-code" name="code" inputmode="numeric" maxlength="6" placeholder="000000" required value="${esc(joinCode)}"
              style="font-size:22px;letter-spacing:8px;text-align:center;font-weight:800">
            ${joinInfo?.isProject ? `
              <div class="join-project-note">
                <b>${esc(joinInfo.title)}</b>
                <span>AI 웹앱 프로젝트 수업입니다.</span>
              </div>
              <label>팀코드 (4자리)</label>
              <input class="input" name="team_code" inputmode="numeric" maxlength="4" placeholder="0000" required>
              <label>익명번호</label>
              <input class="input" name="anonymous_no" maxlength="12" placeholder="예: A01" required>
              <div class="small muted" style="margin-top:10px;line-height:1.6">실명 대신 선생님이 안내한 팀코드와 익명번호를 입력하세요.<br>같은 정보로 다시 들어오면 이전 작업이 복구됩니다.</div>
            ` : `
              <label>이름</label>
              <input class="input" name="name" placeholder="예: 김학생" maxlength="30" required>
              <div class="small muted" style="margin-top:10px;line-height:1.6">선생님이 화면에 보여주는 6자리 코드를 입력하세요.<br>계정·비밀번호 없이 이번 수업 동안만 이용됩니다.</div>
            `}
          ` : otpMode === null ? `
            <label>아이디</label>
            <input class="input" name="username" autocomplete="username" required>
            <label>비밀번호</label>
            <input class="input" name="password" type="password" autocomplete="current-password" required>
          ` : `
            <input type="hidden" name="username" value="${esc(loginCreds.username)}">
            <input type="hidden" name="password" value="${esc(loginCreds.password)}">
            ${otpMode === 'setup' ? `
              <label>2단계 인증 최초 등록</label>
              <div class="small muted" style="line-height:1.7">인증 앱(Google OTP 등)에 아래 키를 등록한 뒤,<br>생성된 6자리 코드를 입력하세요.</div>
              <div class="otp-secret">${esc(secret)}</div>
            ` : '<label>2단계 인증 코드 (6자리)</label>'}
            <input class="input" name="otp" inputmode="numeric" maxlength="6" placeholder="000000" required autofocus>
          `}
          <button class="btn btn-primary" type="submit">${tab === 'join' ? '수업 입장하기' : (otpMode ? '인증하기' : '로그인')}</button>
          <div class="login-error">${esc(errMsg)}</div>
        </form>
      </div>`;
    document.getElementById('login-form').onsubmit = onSubmit;
    const codeInput = document.getElementById('join-code');
    if (codeInput) {
      codeInput.oninput = () => {
        joinCode = codeInput.value.replace(/\D/g, '').slice(0, 6);
        codeInput.value = joinCode;
        joinInfo = null;
        clearTimeout(joinInfoTimer);
        if (joinCode.length !== 6) return;
        joinInfoTimer = setTimeout(async () => {
          try {
            joinInfo = await api('GET', `/api/join-info/${joinCode}`);
            render();
          } catch {
            joinInfo = null;
          }
        }, 180);
      };
    }
    document.querySelectorAll('[data-ltab]').forEach((b) => {
      b.onclick = () => { tab = b.dataset.ltab; otpMode = null; render(); };
    });
  };
  const loginCreds = { username: '', password: '' };
  const enter = (data) => {
    state.me = data.user;
    state.access = data.access;
    state.settings = data.settings;
    state.classSession = data.classSession || null;
    state.mustAgree = !!data.mustAgree;
    state.dash = null;
    Live.stop();
    Live.start(); // 게스트일 때만 내부에서 동작
    location.hash = data.user.mustChangePassword ? '#/password'
      : state.mustAgree ? '#/agreement'
      : data.user.projectTeamId ? '#/project'
      : (level(data.user.role) >= 1 ? '#/' : '#/decks');
  };
  async function onSubmit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    if (tab === 'join') {
      try {
        enter(await api('POST', '/api/join', {
          code: f.get('code'),
          name: f.get('name'),
          team_code: f.get('team_code'),
          anonymous_no: f.get('anonymous_no'),
        }));
      } catch (err) { render(err.message); }
      return;
    }
    loginCreds.username = f.get('username');
    loginCreds.password = f.get('password');
    try {
      enter(await api('POST', '/api/login', {
        username: loginCreds.username, password: loginCreds.password,
        otp: f.get('otp') || undefined,
      }));
    } catch (err) {
      if (err.data?.needOtpSetup) { otpMode = 'setup'; secret = err.data.secret; render(f.get('otp') ? err.message : ''); }
      else if (err.data?.needOtp) { otpMode = 'otp'; render(f.get('otp') ? err.message : ''); }
      else render(err.message);
    }
  }
  render();
});

/* ---------------- 학생 차단 화면 ---------------- */
function renderBlocked() {
  const acc = state.access;
  shell('접근 제한', `
    <div class="blocked-wrap">
      <div class="blocked-hero">${icon('clock')}</div>
      <h2>지금은 접근이 허용된 시간이 아닙니다</h2>
      <p>현재 ${esc(acc.now.dayName)}요일 ${esc(acc.now.time)} (${esc(acc.now.timezone)}) — 아래 허용 시간에 다시 접속해 주세요.</p>
      <div class="card" style="text-align:left">${scheduleMatrixHtml(acc.windows)}</div>
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
    state.classSession = data.classSession || null;
    state.mustAgree = !!data.mustAgree;
    navigate();
  } catch {}
}

/* ---------------- 주간 시간표 매트릭스 ---------------- */
function scheduleMatrixHtml(windows) {
  // 열 = 등록된 시간대(중복 제거, 시작 시간순), 행 = 요일
  const ranges = [...new Set(windows.map((w) => `${w.start_time}~${w.end_time}`))].sort();
  if (ranges.length === 0) return '<div class="empty-note">등록된 허용 시간이 없습니다. 학생 접근은 전면 차단됩니다.</div>';
  const cell = (day, range) => {
    const wins = windows.filter((w) => w.day_of_week === day && `${w.start_time}~${w.end_time}` === range);
    if (wins.length === 0) return '<div class="slot blocked">차단 시간</div>';
    if (wins.every((w) => !w.enabled)) return '<div class="slot locked">자동 잠금</div>';
    const active = wins.filter((w) => w.enabled);
    const deckOnly = active.every((w) => w.deck_id);
    const names = deckOnly
      ? [...new Set(active.map((w) => w.deck_title || '웹앱'))].join(', ')
      : '전체 웹앱';
    return `<div class="slot ${deckOnly ? 'deck-allow' : 'allow'}">${esc(names)}<span class="who">접근 허용</span></div>`;
  };
  return `<div class="matrix-wrap"><table class="matrix">
    <thead><tr><th class="day-col"></th>${ranges.map((r) => `<th>${esc(r)}</th>`).join('')}</tr></thead>
    <tbody>
      ${DAY_ORDER.map((d) => `<tr>
        <td><div class="day-cell">${DAY_NAMES[d]}</div></td>
        ${ranges.map((r) => `<td>${cell(d, r)}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ---------------- 웹앱 배정 모달 ---------------- */
function openAssignModal(deck, onSaved) {
  const back = openModal(`
    <h3>권한 설정 — ${esc(deck.title)}</h3>
    <div class="m-sub">대상 반과 공개 기간을 지정합니다. 대상 반이 비어 있으면 모든 학생에게 공개됩니다.</div>
    <div class="form-grid" style="grid-template-columns:1fr">
      <div><label>대상 반 (쉼표로 구분)</label>
        <input id="am-classes" placeholder="예: 중1-1반, 중1-2반" value="${esc(deck.target_classes || '')}"></div>
    </div>
    <div class="form-grid mt" style="grid-template-columns:1fr 1fr">
      <div><label>권한 시작일</label><input id="am-start" type="date" value="${esc(deck.access_start || '')}"></div>
      <div><label>권한 종료일</label><input id="am-end" type="date" value="${esc(deck.access_end || '')}"></div>
    </div>
    <div class="form-grid mt" style="grid-template-columns:1fr">
      <div><label>공개 상태</label>
        <select id="am-pub"><option value="1" ${deck.published ? 'selected' : ''}>공개</option><option value="0" ${deck.published ? '' : 'selected'}>비공개</option></select></div>
    </div>
    <div class="m-actions">
      <button class="btn btn-ghost" id="am-cancel">취소</button>
      <button class="btn btn-primary" id="am-save">저장</button>
    </div>`);
  back.querySelector('#am-cancel').onclick = () => back.remove();
  back.querySelector('#am-save').onclick = async () => {
    try {
      await api('PATCH', `/api/decks/${deck.id}`, {
        target_classes: back.querySelector('#am-classes').value,
        access_start: back.querySelector('#am-start').value,
        access_end: back.querySelector('#am-end').value,
        published: back.querySelector('#am-pub').value === '1',
      });
      back.remove();
      toast('배정 설정이 저장되었습니다.');
      if (onSaved) onSaved();
    } catch (err) { toast(err.message, true); }
  };
}

/* ---------------- 대시보드 ---------------- */
route(/^#\/$/, async () => {
  if (!isStaff()) { location.hash = '#/decks'; return; }
  const [dash, sched, decksData, cal] = await Promise.all([
    fetchDash(true), api('GET', '/api/schedules'), api('GET', '/api/decks'),
    isAdmin() ? api('GET', '/api/class-calendar').catch(() => null) : Promise.resolve(null),
  ]);
  state.access = sched;
  const s = dash.stats;
  const decks = decksData.decks;
  const preview = decks.find((d) => d.status === 'live') || decks[0];
  const loginDelta = s.todayLogins - s.yesterdayLogins;

  const statCard = (tile, ic, label, num, unit, deltaHtml) => `
    <div class="card stat">
      <div class="tile ${tile}">${icon(ic)}</div>
      <div>
        <div class="lb">${label}</div>
        <div class="num">${num}<span class="unit">${unit}</span></div>
        ${deltaHtml}
      </div>
    </div>`;
  const delta7 = (n) => n > 0
    ? `<span class="delta up">▲ ${n} <span style="font-weight:500">지난 7일</span></span>`
    : '<span class="delta flat">— 지난 7일</span>';

  const roleFlow = [
    ['#7c3aed', 'shield', '슈퍼관리자', '전체 총괄', ['전체 시스템 관리', '관리자 권한 부여', '보안 정책 설정']],
    ['#2563eb', 'briefcase', '관리자', '기관 운영', ['기관 관리', '강사 관리', '웹앱 배정 관리']],
    ['#0d9488', 'userCheck', '강사', '수업 운영', ['수업 운영', '학생 관리', '접근 시간 설정']],
    ['#ea8a0c', 'award', '학생', '수업 참여', ['허용된 시간에만', '수업 웹앱 이용']],
  ];

  shell('대시보드', `
    <div class="grid stats">
      ${statCard('blue', 'decks', '총 웹앱 수', s.decks, `개 · 공개 ${s.publishedDecks}`, delta7(s.decksDelta))}
      ${statCard('mint', 'userCheck', '활성 강사', s.instructors, '명', delta7(s.instructorsDelta))}
      ${statCard('violet', 'users', '활성 학생', s.students, '명', delta7(s.studentsDelta))}
      ${statCard('orange', 'clock', '오늘 접근 허용', s.todayLogins, `건 · 차단 ${s.todayBlocked}`,
        loginDelta > 0 ? `<span class="delta up">▲ ${loginDelta} 전일 대비</span>` : '<span class="delta flat">— 전일 대비</span>')}
    </div>

    <div class="grid main-cols">
      <div class="col-stack">
        <div class="card">
          <h2>역할 및 권한 체계</h2>
          <div class="roles-flow">
            ${roleFlow.map(([color, ic, name, sub, items], i) => `
              ${i > 0 ? `<div class="role-arrow">${icon('chevRight')}</div>` : ''}
              <div class="role-box">
                <div class="rc" style="background:${color}">${icon(ic)}</div>
                <div class="rn">${name}</div>
                <div class="rr">${sub}</div>
                <div class="rd">${items.map((t) => `· ${t}`).join('<br>')}</div>
              </div>`).join('')}
          </div>
        </div>

        ${isAdmin() && cal ? `
        <div class="card">
          <h2>수업 일정 캘린더
            <span class="spacer"></span>
            <select id="cal-filter" class="input" style="width:auto;padding:6px 10px;font-size:12.5px">
              <option value="">전체 강사</option>
              ${cal.teachers.map((t) => `<option value="${t.id}">${esc(t.name)} (${esc(ROLE_LABELS[t.role] || t.role)})</option>`).join('')}
            </select>
          </h2>
          <div id="cal-body">${classCalendarHtml(cal.sessions, '')}</div>
        </div>` : ''}

        ${isAdmin() ? `
        <div class="card">
          <h2>웹앱 허용 시간표
            <span class="spacer"></span>
            <span class="badge green plain">접근 허용</span><span class="badge blue plain">웹앱별</span><span class="badge red plain">차단</span><span class="badge gray plain">자동 잠금</span>
          </h2>
          ${scheduleMatrixHtml(sched.windows)}
          <div class="mt"><a href="#/schedules" class="btn btn-soft btn-sm">시간표 설정 ${icon('chevRight')}</a></div>
        </div>` : ''}

        <div class="card">
          <h2>웹앱 배정 현황 <span class="spacer"></span><a href="#/decks" class="btn btn-soft btn-sm">전체 보기</a></h2>
          <div class="tbl-scroll">
            <table class="tbl resp">
              <thead><tr><th>웹앱명</th><th>담당 강사</th><th>대상 학생</th><th>권한 기간</th><th>상태</th><th></th></tr></thead>
              <tbody>
                ${decks.slice(0, 5).map((d) => `
                  <tr>
                    <td data-label="웹앱명"><div class="cell-main">${esc(d.title)}</div><div class="cell-sub">슬라이드 ${d.slideCount}장</div></td>
                    <td data-label="담당 강사">${esc(d.ownerName)}</td>
                    <td data-label="대상 학생">${esc(d.target_classes) || '<span class="muted">전체</span>'}</td>
                    <td data-label="권한 기간" class="small">${esc(periodText(d))}</td>
                    <td data-label="상태">${deckStatusBadge(d)}</td>
                    <td><button class="btn btn-ghost btn-sm" data-assign="${d.id}">배정</button></td>
                  </tr>`).join('') || '<tr><td colspan="6" class="empty-note">웹앱이 없습니다.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="col-stack">
        ${preview ? `
        <div class="card">
          <h2>웹앱 미리보기</h2>
          <div class="deck-thumb dg-${preview.id % 4}" style="border-radius:13px">
            <div class="deco">🤖</div><div class="orb"></div>
            <div class="dt">${esc(preview.title)}</div>
          </div>
          <div class="preview-kv">
            <span class="k">설명</span><span class="v" style="font-weight:500">${esc(preview.description) || '-'}</span>
            <span class="k">담당 강사</span><span class="v">${esc(preview.ownerName)}</span>
            <span class="k">슬라이드</span><span class="v">${preview.slideCount}개</span>
            <span class="k">대상</span><span class="v">${esc(preview.target_classes) || '전체 학생'}</span>
            <span class="k">상태</span><span>${deckStatusBadge(preview)}</span>
          </div>
          <div style="display:flex;gap:8px">
            <a href="#/view/${preview.id}" class="btn btn-primary btn-sm" style="flex:1;justify-content:center">${icon('play')} 미리보기</a>
            <button class="btn btn-ghost btn-sm" style="flex:1;justify-content:center" data-assign="${preview.id}">${icon('shield')} 권한 설정</button>
          </div>
        </div>` : ''}

        ${isAdmin() ? `
        <div class="card">
          <h2>보안 설정 <span class="spacer"></span><a href="#/security" class="btn btn-soft btn-sm">상세 설정</a></h2>
          <div id="sec-toggles">${securityTogglesHtml(true)}</div>
        </div>` : ''}

        <div class="card">
          <h2>최근 접속 로그 <span class="spacer"></span><span class="badge amber">캡처 시도 누적 ${s.captureAttempts}건</span></h2>
          ${logListHtml(dash.recentLogs)}
          ${isAdmin() ? `<div class="mt"><a href="#/logs" class="btn btn-soft btn-sm">보안 로그 더 보기 ${icon('chevRight')}</a></div>` : ''}
        </div>
      </div>
    </div>`);

  bindSecurityToggles();
  document.querySelectorAll('[data-assign]').forEach((b) => {
    b.onclick = () => {
      const deck = decks.find((d) => d.id === Number(b.dataset.assign));
      if (deck) openAssignModal(deck, navigate);
    };
  });
  // 캘린더 강사 필터 (클라이언트 측 재렌더)
  const calFilter = document.getElementById('cal-filter');
  if (calFilter && cal) {
    calFilter.onchange = () => {
      document.getElementById('cal-body').innerHTML = classCalendarHtml(cal.sessions, calFilter.value);
    };
  }
});

/* 수업 일정 주간 캘린더 (요일 × 시간대). filterId가 있으면 그 담당자만 표시 */
const CAL_COLORS = ['#2563eb', '#0d9488', '#7c3aed', '#ea8a0c', '#dc2626', '#0891b2', '#c026d3'];
function classCalendarHtml(sessions, filterId) {
  const list = sessions.filter((s) => !filterId || String(s.instructor_id) === String(filterId));
  if (!list.length) return '<div class="empty-note">표시할 수업 일정이 없습니다.</div>';
  const toMin = (t) => { const m = /(\d{2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : 0; };
  // 표시 시간 범위 (데이터 기준, 최소 09~18 보장)
  let lo = 9 * 60, hi = 18 * 60;
  list.forEach((s) => { lo = Math.min(lo, toMin(s.start_time)); hi = Math.max(hi, toMin(s.end_time)); });
  lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
  const HPX = 44; // 시간당 픽셀
  const hours = [];
  for (let h = lo / 60; h < hi / 60; h++) hours.push(h);
  const colorOf = (id) => CAL_COLORS[(id || 0) % CAL_COLORS.length];
  const dayCol = (d) => {
    const items = list.filter((s) => s.dow === d);
    return `<div class="cal-day">
      ${items.map((s) => {
        const top = (toMin(s.start_time) - lo) / 60 * HPX;
        const h = Math.max(20, (toMin(s.end_time) - toMin(s.start_time)) / 60 * HPX);
        const c = colorOf(s.instructor_id);
        const dim = s.expired || !s.active;
        return `<div class="cal-ev" style="top:${top}px;height:${h}px;background:${c}1a;border-left:3px solid ${c};${dim ? 'opacity:.5;' : ''}" title="${esc(s.title)} · ${esc(s.instructor_name || '')} · ${esc(s.start_time)}~${esc(s.end_time)}">
          <div class="ce-t">${esc(s.title)}</div>
          <div class="ce-m">${esc(s.start_time)}~${esc(s.end_time)} · ${esc(s.instructor_name || '-')}</div>
        </div>`;
      }).join('')}
    </div>`;
  };
  return `<div class="cal-wrap"><div class="cal-grid" style="--rows:${hours.length}">
    <div class="cal-corner"></div>
    ${DAY_ORDER.map((d) => `<div class="cal-head">${DAY_NAMES[d]}</div>`).join('')}
    <div class="cal-times">${hours.map((h) => `<div class="cal-time" style="height:${HPX}px">${String(h).padStart(2, '0')}:00</div>`).join('')}</div>
    ${DAY_ORDER.map((d) => `<div class="cal-daywrap" style="height:${hours.length * HPX}px">
      ${hours.map(() => `<div class="cal-line" style="height:${HPX}px"></div>`).join('')}
      ${dayCol(d)}
    </div>`).join('')}
  </div></div>`;
}

/* ---------------- 보안 설정 ---------------- */
const SEC_ITEMS = [
  ['block_capture', 'cameraOff', 'red', '화면 캡처 방지 강화', 'PrintScreen 감지 시 화면 가림·클립보드 차단, 시도 즉시 로그 기록'],
  ['block_copy', 'copy', 'blue', '복제/복사 차단', '텍스트 선택·복사·잘라내기·드래그 저장 차단'],
  ['block_rightclick', 'mouse', 'blue', '우클릭 차단', '마우스 오른쪽 버튼 메뉴(이미지 저장 등) 차단'],
  ['watermark', 'droplet', 'mint', '워터마크 추적', '열람자 이름·아이디·시각을 슬라이드 전면에 표시해 유출 추적'],
  ['devtools_detect', 'code', 'violet', '개발자도구 감지', '개발자도구 사용 정황을 감지해 경고 및 로그 기록'],
  ['single_session', 'smartphone', 'orange', '동시접속 제한 (1개 기기)', '학생 계정은 마지막으로 로그인한 기기 1대만 유지'],
  ['ip_restrict', 'globe', 'orange', 'IP 제한', '허용된 네트워크(IP 대역)에서만 학생 로그인 허용'],
  ['two_factor', 'key', 'green', '2단계 인증', '관리자 이상 계정에 인증 앱(OTP) 코드 입력 요구'],
];

function securityTogglesHtml(compact = false) {
  const st = state.settings || {};
  const items = compact ? SEC_ITEMS.slice(0, 5) : SEC_ITEMS;
  return items.map(([key, ic, color, label, desc]) => `
    <div class="sec-row">
      <div class="tile ${color}">${icon(ic)}</div>
      <div class="sx"><div class="sl">${label}</div>${compact ? '' : `<div class="sd">${desc}</div>`}</div>
      <label class="toggle"><input type="checkbox" data-setting="${key}" ${st[key] ? 'checked' : ''}><span class="tr"></span></label>
    </div>`).join('');
}

function bindSecurityToggles() {
  document.querySelectorAll('input[data-setting]').forEach((el) => {
    el.onchange = async () => {
      try {
        const data = await api('PATCH', '/api/settings', { [el.dataset.setting]: el.checked });
        state.settings = data.settings;
        toast('보안 설정이 변경되었습니다.');
      } catch (err) { toast(err.message, true); el.checked = !el.checked; }
    };
  });
}

route(/^#\/security$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const data = await api('GET', '/api/settings');
  state.settings = data.settings;
  shell('보안 설정', `
    <div class="grid main-cols">
      <div class="card">
        <h2>콘텐츠 보호 정책</h2>
        ${securityTogglesHtml()}
      </div>
      <div class="col-stack">
        <div class="card">
          <h2>워터마크 표시 설정</h2>
          <div class="form-grid" style="grid-template-columns:1fr">
            <div><label>표시 내용</label>
              <input id="wm-text" value="${esc(state.settings.wm_text || '{이름} ({아이디}) {시각}')}" maxlength="100">
              <div class="small muted" style="margin-top:5px"><code>{이름}</code> <code>{아이디}</code> <code>{시각}</code>을 조합하세요. 예: <code>{이름} · 무단유출금지</code></div></div>
          </div>
          <div class="form-grid mt" style="grid-template-columns:1fr 1fr">
            <div><label>배치</label>
              <select id="wm-pos">
                <option value="tile" ${state.settings.wm_position === 'tile' ? 'selected' : ''}>전체 반복 (추적에 가장 효과적)</option>
                <option value="corner-br" ${state.settings.wm_position === 'corner-br' ? 'selected' : ''}>우측 하단 1개</option>
                <option value="corner-tl" ${state.settings.wm_position === 'corner-tl' ? 'selected' : ''}>좌측 상단 1개</option>
                <option value="center" ${state.settings.wm_position === 'center' ? 'selected' : ''}>중앙 1개 (크게)</option>
              </select></div>
            <div><label>진하기</label>
              <select id="wm-op">
                <option value="light" ${state.settings.wm_opacity === 'light' ? 'selected' : ''}>연하게</option>
                <option value="medium" ${state.settings.wm_opacity === 'medium' || !state.settings.wm_opacity ? 'selected' : ''}>보통</option>
                <option value="strong" ${state.settings.wm_opacity === 'strong' ? 'selected' : ''}>진하게</option>
              </select></div>
          </div>
          <div class="mt"><div class="field-label">미리보기</div><div id="wm-preview" style="max-width:430px"></div></div>
          <div class="mt"><button class="btn btn-primary btn-sm" id="wm-save">워터마크 설정 저장</button></div>
          <p class="small muted mt" style="line-height:1.7">
            워터마크를 아예 끄려면 왼쪽 "워터마크 추적" 토글을 사용하세요.<br>
            ※ 배치를 모서리 1개로 바꾸면 화면은 깔끔해지지만 잘라내기 쉬워져 <b>유출 추적 효과는 약해집니다</b>. 보호가 중요하면 "전체 반복"을 권장합니다.
          </p>
        </div>
        <div class="card">
          <h2>IP 허용 목록</h2>
          <div class="small muted" style="margin-bottom:10px;line-height:1.7">
            IP 제한이 켜져 있을 때 학생 로그인이 허용되는 IP를 지정합니다.<br>
            쉼표로 구분한 접두어 형식 — 예: <code>211.43.</code> (대역), <code>10.0.0.5</code> (단일)
          </div>
          <textarea class="input" id="ip-allowlist" rows="3" placeholder="예: 211.43., 192.168.">${esc(state.settings.ip_allowlist || '')}</textarea>
          <div class="mt"><button class="btn btn-primary btn-sm" id="save-ips">허용 목록 저장</button></div>
        </div>
        <div class="card">
          <h2>보호 기능 안내</h2>
          <p class="small muted" style="line-height:1.9">
            웹 기술 특성상 화면 캡처를 100% 차단하는 것은 불가능합니다(스마트폰 촬영, OS 수준 캡처 등).
            본 플랫폼의 보호 전략은 <b>캡처 방지 강화 + 워터마크 추적 + 접속 로그 기록</b>의 3중 체계입니다.
            모든 시도는 접속 기록에 남아 유출 경로를 추적할 수 있습니다.
          </p>
        </div>
      </div>
    </div>`);
  bindSecurityToggles();
  document.getElementById('save-ips').onclick = async () => {
    const data2 = await api('PATCH', '/api/settings', { ip_allowlist: document.getElementById('ip-allowlist').value });
    state.settings = data2.settings;
    toast('IP 허용 목록이 저장되었습니다.');
  };

  // 워터마크 설정: 입력값을 임시 적용해 실시간 미리보기
  const wmPreview = () => {
    const saved = { ...state.settings };
    state.settings.wm_text = document.getElementById('wm-text').value;
    state.settings.wm_position = document.getElementById('wm-pos').value;
    state.settings.wm_opacity = document.getElementById('wm-op').value;
    document.getElementById('wm-preview').innerHTML = slideHtml(
      { title: '미리보기 슬라이드', body: '- 워터마크가 이렇게 표시됩니다', bg: 'theme-white', align: 'left' },
      { watermark: true }
    );
    state.settings = saved;
  };
  for (const id of ['wm-text', 'wm-pos', 'wm-op']) {
    document.getElementById(id).addEventListener('input', wmPreview);
  }
  wmPreview();
  document.getElementById('wm-save').onclick = async () => {
    const data3 = await api('PATCH', '/api/settings', {
      wm_text: document.getElementById('wm-text').value,
      wm_position: document.getElementById('wm-pos').value,
      wm_opacity: document.getElementById('wm-op').value,
    });
    state.settings = data3.settings;
    toast('워터마크 설정이 저장되었습니다.');
  };
});

/* ---------------- 수업 입장 코드 ---------------- */
const SESSION_STATUS = { live: ['진행 중', 'green'], expired: ['시간 만료', 'gray'], ended: ['종료됨', 'gray'] };

// 수업 자료 관리 모달: 자료 추가/삭제 + 학생 공개 토글 + 잠금/해제
async function openItemsModal(sessionId, session, allDecks) {
  const kindIcon = (k) => (k === 'link' || k === 'html' ? '🧪' : k === 'slides' ? '📑' : '📄');
  const back = openModal('<div class="m-sub">불러오는 중…</div>');
  const modal = back.querySelector('.modal');
  const rerender = async () => {
    const { items } = await api('GET', `/api/class-sessions/${sessionId}/items`);
    const usedIds = new Set(items.map((i) => i.deck_id));
    const addable = allDecks.filter((d) => !usedIds.has(d.id));
    modal.innerHTML = `
      <h3>자료 관리 — ${esc(session ? session.title : '수업')}</h3>
      <div class="m-sub">각 자료를 <b>학생 공개</b>할지, 지금 <b>열지(잠금 해제)</b>를 조절합니다. PPT·동영상은 공개를 꺼서 강사 발표 전용으로, 웹앱은 잠가두었다가 활동 시간에 여세요.</div>
      <div class="item-list">
        ${items.map((it) => `
          <div class="item-row">
            <div class="ir-main"><span class="ir-ic">${kindIcon(it.kind)}</span><span class="ir-title">${esc(it.deck_title)}</span></div>
            <label class="ir-toggle" title="학생 목록에 노출">
              <input type="checkbox" data-vis="${it.id}" ${it.student_visible ? 'checked' : ''}><span>학생 공개</span>
            </label>
            <button class="btn btn-sm ${it.unlocked ? 'btn-soft' : 'btn-primary'}" data-lock="${it.id}" data-to="${it.unlocked ? 0 : 1}" ${it.student_visible ? '' : 'disabled title="학생 비공개 자료"'}>
              ${it.unlocked ? '🔓 열림' : '🔒 잠금'}
            </button>
            <button class="btn btn-danger btn-sm" data-rm="${it.id}">${icon('trash')}</button>
          </div>`).join('') || '<div class="empty-note">담긴 자료가 없습니다. 아래에서 추가하세요.</div>'}
      </div>
      <div class="mt" style="display:flex;gap:8px">
        <select id="add-deck" class="input" style="flex:1">
          <option value="">+ 자료 추가…</option>
          ${addable.map((d) => `<option value="${d.id}">${kindIcon(d.kind)} ${esc(d.title)}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" id="add-btn">추가</button>
      </div>
      <div class="m-actions"><button class="btn btn-primary" id="items-close">완료</button></div>`;
    modal.querySelector('#items-close').onclick = () => back.remove();
    modal.querySelector('#add-btn').onclick = async () => {
      const v = modal.querySelector('#add-deck').value;
      if (!v) return;
      try { await api('POST', `/api/class-sessions/${sessionId}/items`, { deck_id: Number(v) }); await rerender(); }
      catch (err) { toast(err.message, true); }
    };
    modal.querySelectorAll('[data-vis]').forEach((el) => {
      el.onchange = async () => {
        await api('PATCH', `/api/class-sessions/${sessionId}/items/${el.dataset.vis}`, { student_visible: el.checked });
        await rerender();
      };
    });
    modal.querySelectorAll('[data-lock]').forEach((bt) => {
      bt.onclick = async () => {
        await api('PATCH', `/api/class-sessions/${sessionId}/items/${bt.dataset.lock}`, { unlocked: bt.dataset.to === '1' });
        toast(bt.dataset.to === '1' ? '자료를 열었습니다. 학생 화면에 곧 나타납니다.' : '자료를 잠갔습니다.');
        await rerender();
      };
    });
    modal.querySelectorAll('[data-rm]').forEach((bt) => {
      bt.onclick = async () => {
        await api('DELETE', `/api/class-sessions/${sessionId}/items/${bt.dataset.rm}`);
        await rerender();
      };
    });
  };
  await rerender();
}

route(/^#\/sessions$/, async () => {
  if (!isStaff()) { location.hash = '#/decks'; return; }
  const [data, decksData] = await Promise.all([api('GET', '/api/class-sessions'), api('GET', '/api/decks')]);
  // 관리자 이상은 담당자를 배정할 수 있음 → 강사·관리자 목록 조회 (담당은 관리자일 수도 있음)
  let instructors = [];
  if (isAdmin()) {
    instructors = (await api('GET', '/api/users').catch(() => ({ users: [] }))).users
      .filter((u) => u.active && ['instructor', 'admin', 'superadmin'].includes(u.role) && u.id !== state.me.id);
  }
  shell('수업 입장 코드', `
    <div class="page-head">
      <div><div class="ph-t">수업 입장 코드</div>
        <div class="desc">1회성 수업용 코드입니다. 학생은 계정 없이 <b>코드 + 이름</b>만으로 입장하며, 수업이 끝나면 자동으로 접근이 끊기고 임시 계정은 정리됩니다.</div></div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <h2>새 수업 만들기</h2>
      <form id="cs-form">
        <div class="form-grid">
          <div style="grid-column:span 2"><label>수업명</label><input name="title" required placeholder="예: ○○중학교 1-1반 2차시"></div>
          ${isAdmin() ? `<div><label>담당 강사</label>
            <select name="instructor_id">
              <option value="">나 (${esc(state.me.name)})</option>
              ${instructors.map((u) => `<option value="${u.id}">${esc(u.name)} (${esc(u.username)}·${esc(u.roleLabel)})</option>`).join('')}
            </select></div>` : ''}
          <div><label>유효 시간</label>
            <select name="duration_minutes">
              <option value="60">1시간</option><option value="120" selected>2시간</option>
              <option value="240">4시간</option><option value="480">8시간</option>
            </select></div>
          <div><button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">${icon('plus')} 코드 발급</button></div>
        </div>
        <div class="mt">
          <label class="field-label">수업에 담을 자료 (선택) — 여러 개를 담고, 학생 공개·잠금은 아래 목록의 "자료 관리"에서 조절합니다</label>
          <div class="pick-grid">
            ${decksData.decks.map((d) => `
              <label class="pick-item">
                <input type="checkbox" name="deck_ids" value="${d.id}">
                <span>${d.kind === 'link' || d.kind === 'html' ? '🧪' : d.kind === 'slides' ? '📑' : '📄'} ${esc(d.title)}</span>
              </label>`).join('') || '<span class="small muted">먼저 웹앱/PPT를 만들어 주세요.</span>'}
          </div>
          <div class="small muted" style="margin-top:6px">아무것도 선택하지 않으면 공개 중인 전체 자료가 열립니다.</div>
        </div>
      </form>
      <div class="msg" id="cs-msg"></div>
    </div>
    <div class="card">
      <div class="tbl-scroll">
        <table class="tbl resp">
          <thead><tr><th>입장 코드</th><th>수업명</th><th>담당 강사</th><th>자료</th><th>참여</th><th>상태</th><th>남은 시간</th><th style="width:300px">관리</th></tr></thead>
          <tbody>
            ${data.sessions.map((s) => {
              const [label, color] = SESSION_STATUS[s.status];
              const matText = s.item_count > 0 ? `자료 ${s.item_count}개` : (s.deck_title || '전체 공개 웹앱');
              return `<tr>
                <td data-label="입장 코드"><button class="btn btn-soft btn-sm" data-big="${esc(s.code)}" title="크게 보기" style="font-size:16px;letter-spacing:3px;font-weight:800">${esc(s.code)}</button></td>
                <td data-label="수업명"><div class="cell-main">${esc(s.title)}</div><div class="cell-sub">${esc(s.created_at)}</div></td>
                <td data-label="담당 강사">${esc(s.instructor_name) || '<span class="muted">-</span>'}</td>
                <td data-label="자료">${esc(matText)}</td>
                <td data-label="참여"><b>${s.joined}</b>명</td>
                <td data-label="상태"><span class="badge ${color}">${label}</span></td>
                <td data-label="남은 시간">${s.status === 'live' ? `${Math.floor(s.remainingMinutes / 60)}시간 ${s.remainingMinutes % 60}분` : '-'}</td>
                <td><div class="row-actions">
                  ${s.status !== 'ended' ? `<button class="btn btn-ghost btn-sm" data-items="${s.id}">${icon('folder')} 자료 관리</button>` : ''}
                  ${s.status === 'live' ? `
                    <button class="btn btn-primary btn-sm" data-golive="${s.id}">🔴 라이브</button>
                    <button class="btn btn-ghost btn-sm" data-end="${s.id}">종료</button>` : ''}
                  <button class="btn btn-danger btn-sm" data-csdel="${s.id}">${icon('trash')}</button>
                </div></td>
              </tr>`;
            }).join('') || '<tr><td colspan="8" class="empty-note">아직 만든 수업이 없습니다. 위에서 코드를 발급해 보세요.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`);

  document.getElementById('cs-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById('cs-msg');
    const deckIds = f.getAll('deck_ids').map(Number);
    try {
      const r = await api('POST', '/api/class-sessions', {
        title: f.get('title'), deck_ids: deckIds, duration_minutes: f.get('duration_minutes'),
        instructor_id: f.get('instructor_id') || null,
      });
      showBigCode(r.code, f.get('title'));
      navigate();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
  // 자료 관리 모달
  document.querySelectorAll('[data-items]').forEach((b) => {
    b.onclick = () => openItemsModal(Number(b.dataset.items),
      data.sessions.find((s) => s.id === Number(b.dataset.items)), decksData.decks);
  });
  const showBigCode = (code, title) => {
    openModal(`
      <h3 style="text-align:center">${esc(title || '수업 입장 코드')}</h3>
      <div class="m-sub" style="text-align:center">학생들에게 이 코드를 보여주세요 — 로그인 화면의 "수업 참여"에서 입력합니다</div>
      <div style="text-align:center;font-size:64px;font-weight:800;letter-spacing:14px;color:var(--navy-800);padding:24px 0">${esc(code)}</div>
      <div class="m-actions"><button class="btn btn-primary" onclick="this.closest('.modal-back').remove()">닫기</button></div>`);
  };
  document.querySelectorAll('[data-big]').forEach((b) => {
    const row = data.sessions.find((s) => s.code === b.dataset.big);
    b.onclick = () => showBigCode(b.dataset.big, row ? row.title : '');
  });
  const launchLive = async (sessionId, deckId) => {
    const dd = await api('GET', `/api/decks/${deckId}`);
    if (dd.deck.kind !== 'slides') return toast('라이브 발표는 슬라이드형 웹앱만 가능합니다.', true);
    present(dd.slides, dd.deck.title, { sessionId, deckId });
  };
  document.querySelectorAll('[data-golive]').forEach((b) => {
    b.onclick = async () => {
      const s = data.sessions.find((x) => x.id === Number(b.dataset.golive));
      if (!s) return;
      if (s.deck_id) return launchLive(s.id, s.deck_id);
      // 수업에 지정 웹앱이 없으면 슬라이드형 덱 중에서 선택
      const slideDecks = decksData.decks.filter((d) => d.kind !== 'link');
      if (!slideDecks.length) return toast('발표할 슬라이드 웹앱이 없습니다.', true);
      const back = openModal(`
        <h3>라이브로 발표할 웹앱 선택</h3>
        <div class="m-sub">강사가 슬라이드를 넘기면 이 수업 학생들의 화면이 함께 넘어갑니다.</div>
        <select class="input" id="lv-deck">${slideDecks.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join('')}</select>
        <div class="m-actions">
          <button class="btn btn-ghost" id="lv-cancel">취소</button>
          <button class="btn btn-primary" id="lv-start">🔴 라이브 시작</button>
        </div>`);
      back.querySelector('#lv-cancel').onclick = () => back.remove();
      back.querySelector('#lv-start').onclick = () => {
        const deckId = Number(back.querySelector('#lv-deck').value);
        back.remove();
        launchLive(s.id, deckId);
      };
    };
  });
  document.querySelectorAll('[data-end]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 수업을 종료할까요? 접속 중인 학생은 즉시 차단됩니다.')) return;
      await api('PATCH', `/api/class-sessions/${b.dataset.end}`, {});
      toast('수업이 종료되었습니다.');
      navigate();
    };
  });
  document.querySelectorAll('[data-csdel]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 수업 기록과 임시 학생 계정을 삭제할까요? (접속 기록은 보존됩니다)')) return;
      await api('DELETE', `/api/class-sessions/${b.dataset.csdel}`);
      navigate();
    };
  });
});

/* ---------------- 웹앱(덱) 관리 ---------------- */
// 자료 행의 보조 액션(편집/배정/요금/내보내기/공개/삭제) — 표·간략·상세시트 공용
function deckSecondaryActionsHtml(d) {
  if (d.editable === false) return '<span class="small muted">배정된 자료 (읽기 전용)</span>';
  const editBtn = d.kind === 'link'
    ? `<button class="btn btn-ghost btn-sm" data-linkedit="${d.id}">${icon('edit')} 링크 설정</button>`
    : d.kind === 'html'
      ? `<button class="btn btn-ghost btn-sm" data-htmlup="${d.id}">${icon('edit')} HTML 교체</button>`
      : `<a class="btn btn-ghost btn-sm" href="#/decks/${d.id}/edit">${icon('edit')} 편집</a>`;
  const exportBtn = isAdmin() && d.kind === 'slides' ? `<a class="btn btn-ghost btn-sm" href="#/export/${d.id}" title="PDF/백업 내보내기">${icon('download')}</a>` : '';
  const delBtn = d.deletePending
    ? '<span class="small muted">삭제 승인 대기</span>'
    : d.canDelete
      ? `<button class="btn btn-danger btn-sm" data-del="${d.id}">${icon('trash')} ${state.me.role === 'superadmin' ? '삭제' : '삭제 요청'}</button>`
      : '';
  return `${editBtn}
    <button class="btn btn-ghost btn-sm" data-assign="${d.id}">${icon('shield')} 배정</button>
    <button class="btn btn-ghost btn-sm" data-cost="${d.id}" title="요금 유형 설정">💳 요금</button>
    ${exportBtn}
    <button class="btn btn-ghost btn-sm" data-pub="${d.id}" data-val="${d.published ? 0 : 1}">${d.published ? '비공개로' : '공개하기'}</button>
    ${delBtn}`;
}

// 위 액션들의 이벤트 바인딩 (root 안에서만) — 표/상세시트 어디서든 재사용
function bindDeckActions(root, data) {
  root.querySelectorAll('[data-linkedit]').forEach((b) => {
    b.onclick = () => { const deck = data.decks.find((d) => d.id === Number(b.dataset.linkedit)); if (deck) openLinkModal(deck); };
  });
  root.querySelectorAll('[data-htmlup]').forEach((b) => {
    b.onclick = () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.html,.htm,text/html';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) return toast('HTML 파일은 3MB 이하여야 합니다.', true);
        try { await api('PATCH', `/api/decks/${b.dataset.htmlup}`, { html: await file.text() }); toast('HTML이 교체되었습니다.'); }
        catch (err) { toast(err.message, true); }
      };
      input.click();
    };
  });
  root.querySelectorAll('[data-assign]').forEach((b) => {
    b.onclick = () => { const deck = data.decks.find((d) => d.id === Number(b.dataset.assign)); if (deck) openAssignModal(deck, navigate); };
  });
  root.querySelectorAll('[data-cost]').forEach((b) => {
    b.onclick = () => { const deck = data.decks.find((d) => d.id === Number(b.dataset.cost)); if (deck) openCostModal(deck, navigate); };
  });
  root.querySelectorAll('[data-pub]').forEach((b) => {
    b.onclick = async () => { await api('PATCH', `/api/decks/${b.dataset.pub}`, { published: b.dataset.val === '1' }); navigate(); };
  });
  root.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const isSuper = state.me.role === 'superadmin';
      const ok = isSuper ? confirm('이 웹앱과 모든 슬라이드를 삭제할까요?') : confirm('삭제를 요청할까요? 슈퍼관리자 승인 후 실제로 삭제됩니다.');
      if (!ok) return;
      let reason = '';
      if (!isSuper) reason = prompt('삭제 사유(선택)를 입력하세요.', '') || '';
      const r = await api('DELETE', `/api/decks/${b.dataset.del}`, isSuper ? undefined : { reason });
      toast(isSuper || (r && r.deleted) ? '삭제되었습니다.' : '삭제 요청이 접수되었습니다. 슈퍼관리자 승인을 기다립니다.');
      navigate();
    };
  });
}

// 간략 목록에서 "관리 ⋯" → 상세 + 액션 시트
function openDeckSheet(d, data) {
  const kindText = d.kind === 'link' ? '외부 체험형 웹앱' : d.kind === 'html' ? '업로드형 HTML 웹앱' : `슬라이드 ${d.slideCount}장`;
  const rows = [
    ['유형', kindText],
    ['과목', d.subject || '미분류'],
    ['담당 강사', d.ownerName],
    ['대상 학생', d.target_classes || '전체'],
    ['권한 기간', periodText(d)],
    ['상태', (DECK_STATUS[d.status] || DECK_STATUS.private)[0] + (d.deletePending ? ' · 삭제 대기' : '')],
    ['요금', d.costType === 'api_paid' ? `API 유료${d.apiProvider ? ' (' + d.apiProvider + ')' : ''}` : '무료'],
    ['갱신', String(d.updated_at || '').slice(0, 16)],
  ];
  const back = openModal(`
    <h3>${esc(d.title)}</h3>
    ${d.description ? `<div class="m-sub">${esc(d.description)}</div>` : ''}
    <div class="sheet-detail">
      ${rows.map(([k, v]) => `<div><span class="sd-k">${k}</span><span class="sd-v">${esc(String(v))}</span></div>`).join('')}
    </div>
    <div class="field-label mt" style="margin-bottom:6px">관리</div>
    <div class="row-actions" id="sheet-actions">
      <a class="btn btn-primary btn-sm" href="#/view/${d.id}">${icon('play')} ${d.kind === 'slides' ? '재생' : '열기'}</a>
      ${deckSecondaryActionsHtml(d)}
    </div>
    <div class="m-actions"><button class="btn btn-ghost" id="sheet-close">닫기</button></div>`);
  back.querySelector('#sheet-close').onclick = () => back.remove();
  bindDeckActions(back, data);
  // 액션을 누르면(모달 열기/공개/삭제/이동) 시트는 닫는다
  back.querySelector('#sheet-actions').addEventListener('click', () => back.remove());
}

let deckSubjectTab = 'all';
let deckCostTab = 'all';
let deckView = (typeof localStorage !== 'undefined' && localStorage.getItem('deckView')) || 'compact';
route(/^#\/decks$/, async () => {
  const data = await api('GET', '/api/decks');
  if (state.me.role === 'student') {
    // 게스트: 강사가 자료를 열거나 잠그면 화면이 몇 초 내로 갱신되도록 폴링 훅 등록
    if (state.me.isGuest) {
      window.__deckState = JSON.stringify(data.decks.map((d) => [d.id, d.accessibleNow]));
      window.__deckRefresh = async () => {
        try {
          const fresh = await api('GET', '/api/decks');
          const sig = JSON.stringify(fresh.decks.map((d) => [d.id, d.accessibleNow]));
          if (sig !== window.__deckState && location.hash === '#/decks') navigate();
        } catch {}
      };
    }
    // 학생 화면은 과목(폴더) 구분 없이 자료를 평면으로 나열
    const deckCard = (d, i) => `
      <div class="deck-card">
        <div class="deck-thumb dg-${i % 4}"><div class="deco">${d.kind !== 'slides' ? '🧪' : ['🤖', '💡', '📊', '🚀'][i % 4]}</div><div class="orb"></div><div class="dt">${esc(d.title)}</div></div>
        <div class="body">
          <div class="desc">${esc(d.description) || '설명 없음'}</div>
          <div class="meta">
            <span class="small muted">${d.kind !== 'slides' ? '체험형 웹앱' : `슬라이드 ${d.slideCount}장`} · ${esc(d.ownerName)} 강사</span>
            ${d.accessibleNow
              ? `<a href="#/view/${d.id}" class="btn btn-primary btn-sm">${icon('play')} ${d.kind !== 'slides' ? '체험 시작' : '학습 시작'}</a>`
              : d.locked
                ? '<span class="badge amber">🔒 잠김 — 선생님 대기</span>'
                : '<span class="badge red">차단 시간</span>'}
          </div>
        </div>
      </div>`;
    shell(state.me.isGuest ? '수업 자료' : '내 학습 자료', `
      <div class="deck-cards">
        ${data.decks.map(deckCard).join('') || '<p class="empty-note">아직 열람 가능한 학습 자료가 없습니다.</p>'}
      </div>`);
    return;
  }
  // 과목(폴더) 탭
  const subjects = [...new Set(data.decks.map((d) => d.subject || ''))].filter(Boolean).sort();
  const hasEtc = data.decks.some((d) => !d.subject);
  const tabs = [['all', `전체 (${data.decks.length})`],
    ...subjects.map((s) => [s, `${s} (${data.decks.filter((d) => d.subject === s).length})`]),
    ...(hasEtc && subjects.length ? [['', `미분류 (${data.decks.filter((d) => !d.subject).length})`]] : [])];
  if (deckSubjectTab !== 'all' && !tabs.some(([k]) => k === deckSubjectTab)) deckSubjectTab = 'all';
  const paidCount = data.decks.filter((d) => d.costType === 'api_paid').length;
  const list = data.decks.filter((d) =>
    (deckSubjectTab === 'all' || (d.subject || '') === deckSubjectTab)
    && (deckCostTab === 'all' || (deckCostTab === 'paid' ? d.costType === 'api_paid' : d.costType !== 'api_paid')));
  const typeIco = (d) => d.kind === 'link' ? '🧪' : d.kind === 'html' ? '📦' : '📊';
  const statusLabel = (d) => (DECK_STATUS[d.status] || DECK_STATUS.private)[0];
  // 간략 보기(기본): 제목 위주, 나머지는 "관리 ⋯" 시트로
  const compactBody = `<div class="card" style="padding:6px 12px"><div class="deck-list">
    ${list.map((d) => `
      <div class="deck-line">
        <div class="dl-left">
          <span class="dl-ico">${typeIco(d)}</span>
          <div class="dl-body">
            <div class="dl-title">${esc(d.title)}${d.costType === 'api_paid' ? ' <span title="API 유료">💳</span>' : ''}</div>
            <div class="dl-meta small muted">${d.subject ? `📁 ${esc(d.subject)}` : '미분류'} · ${statusLabel(d)}${d.deletePending ? ' · <span class="amber-text">삭제 대기</span>' : ''}</div>
          </div>
        </div>
        <div class="dl-actions">
          <a class="btn btn-primary btn-sm" href="#/view/${d.id}">${icon('play')} ${d.kind === 'slides' ? '재생' : '열기'}</a>
          <button class="btn btn-ghost btn-sm" data-more="${d.id}">관리 ⋯</button>
        </div>
      </div>`).join('') || '<p class="empty-note">이 폴더에 웹앱이 없습니다. 새로 만들어 보세요.</p>'}
  </div></div>`;
  // 상세 표 보기(토글): 기존 전체 컬럼
  const detailBody = `<div class="card"><div class="tbl-scroll">
    <table class="tbl resp">
      <thead><tr><th>웹앱명</th><th>과목</th><th>담당 강사</th><th>대상 학생</th><th>권한 기간</th><th>상태</th><th style="width:300px">관리</th></tr></thead>
      <tbody>
        ${list.map((d) => `
          <tr>
            <td data-label="웹앱명"><div class="cell-main">${typeIco(d)} ${esc(d.title)} ${costBadge(d)}</div><div class="cell-sub">${esc(d.description) || ''} · ${d.kind === 'link' ? '외부 체험형 웹앱' : d.kind === 'html' ? '업로드형 HTML 웹앱' : `슬라이드 ${d.slideCount}장`} · ${esc(d.updated_at)}</div></td>
            <td data-label="과목">${d.subject ? `<span class="badge violet plain">📁 ${esc(d.subject)}</span>` : '<span class="muted small">미분류</span>'}</td>
            <td data-label="담당 강사">${esc(d.ownerName)}</td>
            <td data-label="대상 학생">${esc(d.target_classes) || '<span class="muted">전체</span>'}</td>
            <td data-label="권한 기간" class="small">${esc(periodText(d))}</td>
            <td data-label="상태">${deckStatusBadge(d)}${d.deletePending ? ' <span class="badge amber">삭제 대기</span>' : ''}</td>
            <td><div class="row-actions">
              <a class="btn btn-primary btn-sm" href="#/view/${d.id}">${icon('play')} ${d.kind === 'slides' ? '재생' : '열기'}</a>
              ${deckSecondaryActionsHtml(d)}
            </div></td>
          </tr>`).join('') || '<tr><td colspan="7" class="empty-note">이 폴더에 웹앱이 없습니다. 새로 만들어 보세요.</td></tr>'}
      </tbody>
    </table>
  </div></div>`;
  shell('웹앱/PPT 관리', `
    <div class="page-head">
      <div><div class="ph-t">웹앱 라이브러리</div><div class="desc">PPT처럼 발표할 수 있는 웹앱(슬라이드 덱)을 과목별 폴더로 관리합니다.</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="deck-view-toggle">${deckView === 'compact' ? '☰ 표로 보기' : '≣ 간략히'}</button>
        <button class="btn btn-primary" id="btn-new-deck">${icon('plus')} 새 웹앱 만들기</button>
      </div>
    </div>
    <div class="tabs">
      ${tabs.map(([k, label]) => `<button data-stab="${esc(k)}" class="${deckSubjectTab === k ? 'active' : ''}">${k === 'all' ? '' : '📁 '}${esc(label)}</button>`).join('')}
    </div>
    <div class="tabs" style="margin-top:-4px">
      ${[['all', `요금 전체`], ['free', `🆓 무료 (${data.decks.length - paidCount})`], ['paid', `💳 API 유료 (${paidCount})`]]
        .map(([k, label]) => `<button data-ctab="${k}" class="${deckCostTab === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    ${deckView === 'detailed' ? detailBody : compactBody}`);
  document.querySelectorAll('[data-stab]').forEach((b) => {
    b.onclick = () => { deckSubjectTab = b.dataset.stab; navigate(); };
  });
  document.querySelectorAll('[data-ctab]').forEach((b) => {
    b.onclick = () => { deckCostTab = b.dataset.ctab; navigate(); };
  });
  document.getElementById('deck-view-toggle').onclick = () => {
    deckView = deckView === 'compact' ? 'detailed' : 'compact';
    try { localStorage.setItem('deckView', deckView); } catch {}
    navigate();
  };
  document.querySelectorAll('[data-more]').forEach((b) => {
    b.onclick = () => { const deck = data.decks.find((d) => d.id === Number(b.dataset.more)); if (deck) openDeckSheet(deck, data); };
  });
  bindDeckActions(document, data); // 상세 표 보기의 액션 버튼
  document.getElementById('btn-new-deck').onclick = () => {
    const back = openModal(`
      <h3>새 웹앱 만들기</h3>
      <div class="m-sub">직접 만드는 슬라이드, 또는 이미 배포된 체험형 웹앱(주소 연결) 중에서 선택하세요.</div>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div><label>유형</label>
          <select id="nd-kind">
            <option value="slides">슬라이드 (이 플랫폼에서 직접 제작)</option>
            <option value="html">HTML 파일 업로드 (배포 없이 바로 실행)</option>
            <option value="link">외부 배포 웹앱 (주소 연결 · 유출 방지 게이트)</option>
          </select></div>
        <div><label>제목</label><input id="nd-title" placeholder="예: AI 프롬프트 연습"></div>
        <div id="nd-url-row" style="display:none"><label>웹앱 주소 (https://)</label>
          <input id="nd-url" placeholder="예: https://ai-prompt-practice.vercel.app"></div>
        <div id="nd-html-row" style="display:none"><label>HTML 파일 (.html, 3MB 이하)</label>
          <input id="nd-html" type="file" accept=".html,.htm,text/html">
          <div class="small muted" style="margin-top:5px">CSS·자바스크립트가 파일 안에 포함된 단일 HTML이어야 합니다. (AI로 만든 웹앱 파일 그대로 OK)</div></div>
        <div><label>과목 (폴더)</label>
          <input id="nd-subject" list="subject-list" placeholder="예: AI 진로교육 — 기존 과목을 고르거나 새로 입력">
          <datalist id="subject-list">${subjects.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
        <div><label>설명</label><input id="nd-desc" placeholder="예: 나에게 맞는 미래를 찾는 인터랙티브 수업"></div>
        <div><label>요금 유형</label>
          <select id="nd-cost">
            <option value="free">🆓 무료</option>
            <option value="api_paid">💳 API 유료 (종량 과금)</option>
          </select></div>
        <div id="nd-paid-row" style="display:none;grid-template-columns:1fr 1fr;gap:10px">
          <div><label>API 제공자</label><input id="nd-provider" placeholder="예: OpenAI"></div>
          <div><label>1인·1회 예상 원가(원)</label><input id="nd-unit" type="number" min="0" value="0"></div>
        </div>
      </div>
      <div class="m-actions">
        <button class="btn btn-ghost" id="nd-cancel">취소</button>
        <button class="btn btn-primary" id="nd-save">만들기</button>
      </div>`);
    back.querySelector('#nd-kind').onchange = (e) => {
      back.querySelector('#nd-url-row').style.display = e.target.value === 'link' ? 'block' : 'none';
      back.querySelector('#nd-html-row').style.display = e.target.value === 'html' ? 'block' : 'none';
    };
    back.querySelector('#nd-cost').onchange = (e) => {
      back.querySelector('#nd-paid-row').style.display = e.target.value === 'api_paid' ? 'grid' : 'none';
    };
    back.querySelector('#nd-cancel').onclick = () => back.remove();
    back.querySelector('#nd-save').onclick = async () => {
      const title = back.querySelector('#nd-title').value.trim();
      const kind = back.querySelector('#nd-kind').value;
      if (!title) return toast('제목을 입력하세요.', true);
      try {
        let html;
        if (kind === 'html') {
          const file = back.querySelector('#nd-html').files[0];
          if (!file) return toast('HTML 파일을 선택하세요.', true);
          if (file.size > 3 * 1024 * 1024) return toast('HTML 파일은 3MB 이하여야 합니다.', true);
          html = await file.text();
        }
        const r = await api('POST', '/api/decks', {
          title, kind, html,
          external_url: back.querySelector('#nd-url').value,
          description: back.querySelector('#nd-desc').value,
          subject: back.querySelector('#nd-subject').value,
          cost_type: back.querySelector('#nd-cost').value,
          api_provider: back.querySelector('#nd-provider').value,
          unit_cost: Number(back.querySelector('#nd-unit').value) || 0,
        });
        back.remove();
        if (kind === 'link') { toast('외부 웹앱이 등록되었습니다. "링크 설정"에서 유출 방지 스크립트를 확인하세요.'); navigate(); }
        else if (kind === 'html') { toast('HTML 웹앱이 업로드되었습니다. "열기"로 바로 실행해 보세요.'); navigate(); }
        else location.hash = `#/decks/${r.id}/edit`;
      } catch (err) { toast(err.message, true); }
    };
  };
});

/* ---------------- 내보내기 (관리자 이상: PDF 저장 / JSON 백업) ---------------- */
route(/^#\/export\/(\d+)$/, async (id) => {
  if (!isAdmin()) { location.hash = '#/decks'; return; }
  const data = await api('GET', `/api/decks/${id}`);
  if (data.deck.kind !== 'slides') { location.hash = '#/decks'; return; }
  document.body.classList.add('allow-print');
  shell(`내보내기 — ${data.deck.title}`, `
    <div class="page-head export-toolbar">
      <div><div class="ph-t">${icon('download')} ${esc(data.deck.title)} 내보내기</div>
        <div class="desc">PDF 저장: 인쇄 대화상자에서 "PDF로 저장" 선택 · 용지 방향 "가로" 권장. 슬라이드 1장 = 1페이지.</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" id="btn-json">JSON 백업</button>
        <button class="btn btn-primary" id="btn-pdf">${icon('download')} PDF로 저장 (인쇄)</button>
      </div>
    </div>
    <div class="export-pages">
      ${data.slides.map((s) => `<div class="print-page">${slideHtml(s)}</div>`).join('') || '<p class="empty-note">슬라이드가 없습니다.</p>'}
    </div>`);
  document.getElementById('btn-pdf').onclick = () => window.print();
  document.getElementById('btn-json').onclick = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      deck: {
        title: data.deck.title, description: data.deck.description, subject: data.deck.subject,
        target_classes: data.deck.target_classes, access_start: data.deck.access_start, access_end: data.deck.access_end,
      },
      slides: data.slides.map((s) => ({ title: s.title, body: s.body, bg: s.bg, align: s.align })),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${data.deck.title}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('JSON 백업이 다운로드되었습니다.');
  };
});

/* ---------------- 라이브 따라가기 화면 (게스트) ---------------- */
route(/^#\/live$/, async () => {
  if (!state.me || !state.me.isGuest) { location.hash = '#/'; return; }
  let live = Live.last;
  if (!live) {
    try { live = (await api('GET', `/api/class-sessions/${state.classSession.id}/live`)).live; } catch {}
  }
  if (!live) { location.hash = '#/decks'; return; }

  const wm = state.settings && state.settings.watermark;
  let deckId = live.deckId;
  let slides = [];
  try { slides = (await api('GET', `/api/decks/${deckId}`)).slides; } catch { location.hash = '#/decks'; return; }
  let idx = Math.min(live.slide, Math.max(0, slides.length - 1));

  shell('라이브 수업', `
    <div class="page-head">
      <div><div class="ph-t">🔴 라이브 수업 진행 중</div>
        <div class="desc">선생님이 화면을 넘기면 이 화면도 함께 넘어갑니다.</div></div>
      <span class="badge red">LIVE</span>
    </div>
    <div style="max-width:1000px">
      <div id="live-slide">${slides.length ? slideHtml(slides[idx], { watermark: wm }) : '<p class="empty-note">슬라이드 준비 중…</p>'}</div>
      <p class="small muted mt" id="live-counter">${idx + 1} / ${slides.length} · 선생님이 진행 중</p>
    </div>`);

  window.__liveUpdate = async (lv) => {
    if (lv.deckId !== deckId) { navigate(); return; } // 발표 자료가 바뀌면 다시 로드
    if (lv.slide === idx) return;
    idx = Math.min(lv.slide, Math.max(0, slides.length - 1));
    const el = document.getElementById('live-slide');
    if (el && slides.length) {
      el.innerHTML = slideHtml(slides[idx], { watermark: wm });
      document.getElementById('live-counter').textContent = `${idx + 1} / ${slides.length} · 선생님이 진행 중`;
    }
  };
});

/* ---------------- 외부 웹앱 링크 설정 (유출 방지 게이트 안내 포함) ---------------- */
function gateSnippet() {
  return `<script>
(function () {
  var PLATFORM = '${location.origin}';
  function block() {
    document.documentElement.innerHTML =
      '<div style="font-family:sans-serif;display:flex;height:100vh;' +
      'align-items:center;justify-content:center;text-align:center;color:#334">' +
      '이 체험 웹앱은 수업 플랫폼을 통해서만<br>접속할 수 있습니다.</div>';
  }
  var t = new URLSearchParams(location.search).get('gate');
  if (!t) { block(); return; }
  fetch(PLATFORM + '/api/gate/verify?token=' + encodeURIComponent(t))
    .then(function (r) { return r.json(); })
    .then(function (d) { if (!d.valid) block(); })
    .catch(block);
})();
<\/script>`;
}

// API 호출량 보고 스니펫 — 외부 앱이 API를 호출할 때마다 reportApiUsage() 를 부른다.
// (게이트 토큰으로 인증 → 수업·강사 단위로 자동 귀속. sendBeacon이라 CORS 사전요청 없음)
function usageSnippet() {
  return `<script>
(function () {
  var PLATFORM = '${location.origin}';
  var token = new URLSearchParams(location.search).get('gate');
  // API를 호출할 때마다 이 함수를 호출하세요. 예: reportApiUsage(1)
  window.reportApiUsage = function (calls) {
    if (!token) return;
    var payload = JSON.stringify({ token: token, calls: calls || 1 });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(PLATFORM + '/api/usage/report', payload);
      else fetch(PLATFORM + '/api/usage/report', { method: 'POST', body: payload, keepalive: true });
    } catch (e) {}
  };
})();
<\/script>`;
}

// 요금 유형 설정 (모든 유형의 자료 공용)
function openCostModal(deck, onSaved) {
  const paid = deck.costType === 'api_paid';
  const back = openModal(`
    <h3>요금 유형 — ${esc(deck.title)}</h3>
    <div class="m-sub">API 비용이 드는 자료는 'API 유료'로 지정하면 학생 사용량이 자동 집계되어 종량 정산 리포트에 반영됩니다.</div>
    <div class="form-grid" style="grid-template-columns:1fr">
      <div><label>유형</label>
        <select id="cm-type">
          <option value="free" ${!paid ? 'selected' : ''}>🆓 무료</option>
          <option value="api_paid" ${paid ? 'selected' : ''}>💳 API 유료 (종량 과금)</option>
        </select></div>
      <div id="cm-paid" style="display:${paid ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:10px">
        <div><label>API 제공자</label><input id="cm-provider" value="${esc(deck.apiProvider || '')}" placeholder="예: OpenAI"></div>
        <div><label>1인·1회 예상 원가(원)</label><input id="cm-unit" type="number" min="0" value="${Number(deck.unitCost || 0)}"></div>
      </div>
    </div>
    <div class="m-actions">
      <button class="btn btn-ghost" id="cm-cancel">취소</button>
      <button class="btn btn-primary" id="cm-save">저장</button>
    </div>`);
  back.querySelector('#cm-type').onchange = (e) => {
    back.querySelector('#cm-paid').style.display = e.target.value === 'api_paid' ? 'grid' : 'none';
  };
  back.querySelector('#cm-cancel').onclick = () => back.remove();
  back.querySelector('#cm-save').onclick = async () => {
    try {
      await api('PATCH', `/api/decks/${deck.id}`, {
        cost_type: back.querySelector('#cm-type').value,
        api_provider: back.querySelector('#cm-provider').value,
        unit_cost: Number(back.querySelector('#cm-unit').value) || 0,
      });
      back.remove();
      toast('요금 유형이 저장되었습니다.');
      if (onSaved) onSaved();
    } catch (err) { toast(err.message, true); }
  };
}

function openLinkModal(deck) {
  const back = openModal(`
    <h3>외부 웹앱 설정 — ${esc(deck.title)}</h3>
    <div class="m-sub">학생은 이 플랫폼을 통해서만 웹앱을 열게 됩니다.</div>
    <div class="form-grid" style="grid-template-columns:1fr">
      <div><label>웹앱 주소 (https://)</label><input id="lm-url" value="${esc(deck.external_url)}"></div>
    </div>
    <div class="mt">
      <div class="field-label">🛡️ 유출 방지 게이트 (강력 권장)</div>
      <div class="small muted" style="line-height:1.7">
        아래 스크립트를 웹앱의 <code>&lt;/body&gt;</code> 바로 앞에 붙여넣으면,
        이 플랫폼이 발급한 <b>15분짜리 서명 토큰 없이는 웹앱이 스스로 접속을 거부</b>합니다.
        누가 주소를 알아내 공유해도 열리지 않습니다.
      </div>
      <div class="snippet-box" id="lm-snippet">${esc(gateSnippet())}</div>
      <button class="btn btn-ghost btn-sm mt" id="lm-copy">스크립트 복사</button>
      <span class="small muted"> — 스크립트를 넣지 않아도 플랫폼 안에서는 열리지만, 원본 주소가 유출되면 직접 접속을 막을 수 없습니다.</span>
    </div>
    ${deck.costType === 'api_paid' ? `<div class="mt">
      <div class="field-label">💳 사용량 보고 스니펫 (API 유료 자료)</div>
      <div class="small muted" style="line-height:1.7">
        이 스니펫을 함께 넣고, 웹앱이 <b>API를 호출할 때마다</b> <code>reportApiUsage(1)</code>을 부르면
        실제 호출 수가 <b>수업·강사 단위로</b> 집계되어 "종량 정산"에 반영됩니다.
        (넣지 않으면 열람 1회 = 1호출로 추정 집계)
      </div>
      <div class="snippet-box" id="lm-usnippet">${esc(usageSnippet())}</div>
      <button class="btn btn-ghost btn-sm mt" id="lm-ucopy">보고 스니펫 복사</button>
    </div>` : ''}
    <div class="m-actions">
      <button class="btn btn-ghost" id="lm-cancel">닫기</button>
      <button class="btn btn-primary" id="lm-save">저장</button>
    </div>`);
  back.querySelector('#lm-cancel').onclick = () => back.remove();
  back.querySelector('#lm-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(gateSnippet()); toast('스크립트가 복사되었습니다.'); }
    catch { toast('복사에 실패했습니다. 직접 선택해 복사하세요.', true); }
  };
  const ucopy = back.querySelector('#lm-ucopy');
  if (ucopy) ucopy.onclick = async () => {
    try { await navigator.clipboard.writeText(usageSnippet()); toast('보고 스니펫이 복사되었습니다.'); }
    catch { toast('복사에 실패했습니다. 직접 선택해 복사하세요.', true); }
  };
  back.querySelector('#lm-save').onclick = async () => {
    try {
      await api('PATCH', `/api/decks/${deck.id}`, { external_url: back.querySelector('#lm-url').value });
      back.remove();
      toast('저장되었습니다.');
      navigate();
    } catch (err) { toast(err.message, true); }
  };
}

/* ---------------- 뷰어 + 프레젠테이션 ---------------- */
route(/^#\/view\/(\d+)$/, async (id) => {
  const data = await api('GET', `/api/decks/${id}`);
  const wm = state.settings && state.settings.watermark;

  // 업로드형 HTML 웹앱: 플랫폼이 직접 서빙 (배포 불필요)
  if (data.deck.kind === 'html') {
    shell(data.deck.title, `
      <div class="page-head">
        <div><div class="ph-t">📦 ${esc(data.deck.title)}</div>
          <div class="desc">${esc(data.deck.description)} · ${esc(data.deck.ownerName)} 강사 · 업로드형 웹앱</div></div>
        <button class="btn btn-primary" id="btn-embed-full">${icon('play')} 전체화면</button>
      </div>
      <div class="embed-wrap no-select" id="embed-wrap">
        <iframe src="/api/webapp/${data.deck.id}" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups" allow="fullscreen" referrerpolicy="no-referrer"></iframe>
        ${wm ? watermarkDiv() : ''}
      </div>`);
    document.getElementById('btn-embed-full').onclick = () => {
      document.getElementById('embed-wrap').requestFullscreen?.().catch(() => {});
    };
    return;
  }

  // 외부 체험형 웹앱: 게이트 토큰을 붙여 플랫폼 안에서 임베드
  if (data.deck.kind === 'link') {
    const gate = await api('GET', `/api/gate-token/${id}`);
    shell(data.deck.title, `
      <div class="page-head">
        <div><div class="ph-t">🧪 ${esc(data.deck.title)}</div>
          <div class="desc">${esc(data.deck.description)} · ${esc(data.deck.ownerName)} 강사 · 체험형 웹앱</div></div>
        <div style="display:flex;gap:8px">
          ${data.canEdit ? `<button class="btn btn-ghost" id="btn-linkedit">${icon('edit')} 링크 설정</button>` : ''}
          <button class="btn btn-primary" id="btn-embed-full">${icon('play')} 전체화면</button>
        </div>
      </div>
      <div class="embed-wrap no-select" id="embed-wrap">
        <iframe src="${esc(gate.url)}" allow="fullscreen; clipboard-write" referrerpolicy="no-referrer"></iframe>
        ${wm ? watermarkDiv() : ''}
      </div>
      <p class="small muted mt">접속 토큰은 ${gate.expiresInMinutes}분간 유효합니다. 화면 위 워터마크로 열람자가 식별됩니다.</p>`);
    document.getElementById('btn-embed-full').onclick = () => {
      document.getElementById('embed-wrap').requestFullscreen?.().catch(() => {});
    };
    const editBtn = document.getElementById('btn-linkedit');
    if (editBtn) editBtn.onclick = () => openLinkModal(data.deck);
    return;
  }

  let idx = 0;
  shell(data.deck.title, `
    <div class="page-head">
      <div><div class="ph-t">${esc(data.deck.title)}</div><div class="desc">${esc(data.deck.description)} · 슬라이드 ${data.slides.length}장 · ${esc(data.deck.ownerName)} 강사</div></div>
      <div style="display:flex;gap:8px">
        ${data.canEdit ? `<a class="btn btn-ghost" href="#/decks/${id}/edit">${icon('edit')} 편집</a>` : ''}
        <button class="btn btn-primary" id="btn-present">${icon('play')} 전체화면 발표</button>
      </div>
    </div>
    <div style="max-width:980px">
      <div id="viewer-slide">${data.slides.length ? slideHtml(data.slides[0], { watermark: wm }) : '<p class="empty-note">슬라이드가 없습니다.</p>'}</div>
      <div class="mt" style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="prev">← 이전</button>
        <span id="counter" class="muted small">1 / ${data.slides.length}</span>
        <button class="btn btn-ghost btn-sm" id="next">다음 →</button>
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

function present(slides, title, live = null) {
  // live = { sessionId, deckId } — 슬라이드 이동을 서버에 기록해 학생 화면이 따라오게 함
  if (!slides.length) return toast('슬라이드가 없습니다.', true);
  Protect.presenting = true;
  Protect.apply();
  let idx = 0;
  const wm = state.settings && state.settings.watermark;
  const overlay = document.createElement('div');
  overlay.className = 'present-overlay no-select';
  const syncLive = () => {
    if (!live) return;
    api('PATCH', `/api/class-sessions/${live.sessionId}/live`, { deck_id: live.deckId, slide: idx }).catch(() => {});
  };
  const render = () => {
    overlay.innerHTML = `
      <div class="stage">${slideHtml(slides[idx], { watermark: wm })}</div>
      <div class="progress"><div class="fill" style="width:${((idx + 1) / slides.length) * 100}%"></div></div>
      <div class="present-bar">
        <span>${live ? '🔴 라이브 — 학생 화면이 함께 넘어갑니다 · ' : ''}${esc(title)}</span>
        <span>${idx + 1} / ${slides.length} — 방향키·클릭으로 이동</span>
        <button id="exit-present">${live ? '라이브 종료' : '종료'} (ESC)</button>
      </div>`;
    overlay.querySelector('#exit-present').onclick = exit;
    overlay.querySelector('.stage').onclick = (e) => {
      if (e.offsetX < overlay.clientWidth / 4) go(-1); else go(1);
    };
  };
  const go = (d) => { idx = Math.max(0, Math.min(slides.length - 1, idx + d)); render(); syncLive(); };
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
    else if (e.key === 'Escape') exit();
  };
  const exit = () => {
    presentExit = null;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    Protect.presenting = false;
    Protect.apply();
    if (live) api('PATCH', `/api/class-sessions/${live.sessionId}/live`, { deck_id: null }).catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  presentExit = exit;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.requestFullscreen?.().catch(() => {});
  render();
  syncLive();
}

/* ---------------- 편집기 ---------------- */
route(/^#\/decks\/(\d+)\/edit$/, async (id) => {
  if (!isStaff()) { location.hash = '#/decks'; return; }
  const data = await api('GET', `/api/decks/${id}`);
  if (!data.canEdit || data.deck.kind !== 'slides') { location.hash = '#/decks'; return; }
  let slides = data.slides;
  let sel = 0;

  // 슬라이드 종류 판별: 이미지 / 동영상 / (레거시) 텍스트
  const slideKind = (s) => {
    const b = String(s.body || '').trim();
    if (/^!video\(/.test(b)) return 'video';
    if (/^!\[[^\]]*\]\(/.test(b) && !String(s.title || '').trim()) return 'image';
    return 'text';
  };
  const kindTag = { image: '🖼️ 이미지', video: '🎬 동영상', text: '📝 텍스트' };

  const listHtml = () => slides.map((s, i) => `
    <div class="slide-item ${i === sel ? 'active' : ''}" data-i="${i}">
      <span class="n">${i + 1}</span><span class="t">${kindTag[slideKind(s)]}</span>
    </div>`).join('') || '<div class="empty-note" style="padding:18px">슬라이드가 없습니다. 아래에서 PPT 이미지 또는 동영상을 추가하세요.</div>';

  shell(`편집 — ${data.deck.title}`, `
    <div class="page-head">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input class="input" id="deck-title" value="${esc(data.deck.title)}" style="font-weight:800;width:250px">
        <input class="input" id="deck-subject" value="${esc(data.deck.subject || '')}" placeholder="과목 (폴더)" style="width:150px">
        <input class="input" id="deck-desc" value="${esc(data.deck.description)}" placeholder="설명" style="width:250px">
        <button class="btn btn-ghost btn-sm" id="save-deck">덱 정보 저장</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${deckStatusBadge(data.deck)}
        <a class="btn btn-primary btn-sm" href="#/view/${id}">${icon('play')} 미리보기/발표</a>
      </div>
    </div>
    <div class="editor">
      <div class="col-stack">
        <div class="slide-list" id="slide-list">${listHtml()}</div>
        <div class="mt" style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" id="mv-up">↑ 위로</button>
          <button class="btn btn-ghost btn-sm" id="mv-dn">↓ 아래로</button>
          <button class="btn btn-danger btn-sm" id="del-slide">${icon('trash')} 슬라이드 삭제</button>
        </div>
        <div class="card">
          <h2 style="margin-top:0">슬라이드 추가 <span class="sub">이미지 또는 동영상으로만 만들어집니다</span></h2>
          <button class="btn btn-primary btn-sm" id="import-ppt" style="width:100%;justify-content:center">📥 PPT 이미지 가져오기</button>
          <input type="file" id="import-files" accept="image/png,image/jpeg,image/webp" multiple style="display:none">
          <div class="small muted" style="margin:7px 0 4px;line-height:1.6">
            PowerPoint에서 <b>파일 → 내보내기 → PNG/JPEG</b>로 저장한 슬라이드 이미지들을
            한꺼번에 선택하면 순서대로 슬라이드가 됩니다. (디자인 원본 그대로)
          </div>
          <div class="msg" id="import-msg"></div>
          <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
          <div class="field-label" style="margin:0 0 6px">🎬 동영상 슬라이드 추가</div>
          <div class="small muted" style="margin-bottom:8px;line-height:1.6">
            이미지 슬라이드 사이에 동영상을 한 장의 슬라이드로 넣습니다.
            예를 들어 1·2·3번 슬라이드 다음에 동영상 슬라이드를 두면 순서대로 재생됩니다.
          </div>
          <div style="display:flex;gap:6px;margin-bottom:8px">
            <input class="input" id="vid-url" placeholder="유튜브 또는 mp4/webm 주소" style="flex:1">
            <button class="btn btn-soft btn-sm" id="vid-url-add">URL 추가</button>
          </div>
          <button class="btn btn-ghost btn-sm" id="vid-file-btn" style="width:100%;justify-content:center">동영상 파일 업로드</button>
          <input type="file" id="vid-file" accept="video/mp4,video/webm" style="display:none">
          <div class="small muted" style="margin-top:6px" id="vid-hint"></div>
          <div class="msg" id="vid-msg"></div>
        </div>
      </div>
      <div class="col-stack">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="field-label" style="margin:0">미리보기</div>
            <span class="small muted" id="sel-kind"></span>
          </div>
          <div id="preview" class="mt" style="max-width:780px"></div>
        </div>
      </div>
    </div>`);

  const $ = (s) => document.querySelector(s);

  const loadForm = () => {
    const s = slides[sel];
    if (!s) { $('#preview').innerHTML = '<p class="empty-note">추가된 슬라이드가 없습니다.</p>'; $('#sel-kind').textContent = ''; return; }
    $('#sel-kind').textContent = `${sel + 1}번 · ${kindTag[slideKind(s)]} 슬라이드`;
    $('#preview').innerHTML = slideHtml({ title: s.title, body: s.body, bg: s.bg, align: s.align });
  };
  const refreshList = () => { $('#slide-list').innerHTML = listHtml(); bindList(); };
  const bindList = () => {
    document.querySelectorAll('.slide-item').forEach((el) => {
      el.onclick = () => { sel = Number(el.dataset.i); refreshList(); loadForm(); };
    });
  };
  bindList();
  loadForm();

  $('#save-deck').onclick = async () => {
    await api('PATCH', `/api/decks/${id}`, {
      title: $('#deck-title').value, description: $('#deck-desc').value, subject: $('#deck-subject').value,
    });
    toast('덱 정보가 저장되었습니다.');
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

  const reload = async (selectLast = true) => {
    const fresh = await api('GET', `/api/decks/${id}`);
    slides = fresh.slides;
    if (selectLast) sel = slides.length - 1;
    sel = Math.min(Math.max(0, sel), Math.max(0, slides.length - 1));
    refreshList(); loadForm();
  };

  // ---- PPT 이미지 가져오기: 클라이언트에서 리사이즈·압축 후 순서대로 업로드 ----
  const compressImage = (file, maxW = 1600) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => reject(new Error(`${file.name} 파일을 읽을 수 없습니다.`));
    img.src = URL.createObjectURL(file);
  });

  $('#import-ppt').onclick = () => $('#import-files').click();
  $('#import-files').onchange = async (e) => {
    // 파일명 자연 정렬 (슬라이드1, 슬라이드2, … 슬라이드10 순서 유지)
    const files = [...e.target.files].sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    if (!files.length) return;
    const msg = $('#import-msg');
    try {
      for (let i = 0; i < files.length; i++) {
        msg.textContent = `업로드 중… ${i + 1} / ${files.length} (${files[i].name})`;
        msg.className = 'msg';
        const dataUrl = await compressImage(files[i]);
        await api('POST', `/api/decks/${id}/import-image`, { data: dataUrl });
      }
      msg.textContent = `${files.length}장을 가져왔습니다.`;
      msg.className = 'msg ok';
      await reload();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'msg err';
    }
    e.target.value = '';
  };

  // ---- 동영상 슬라이드: 빈 슬라이드 생성 후 본문을 !video(...) 한 줄로 지정 ----
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    r.readAsDataURL(file);
  });
  const addVideoSlide = async (src) => {
    // 새 슬라이드를 만든 뒤 본문을 동영상 한 줄로 채운다 (전체화면 재생)
    const { id: sid } = await api('POST', `/api/decks/${id}/slides`, {});
    await api('PATCH', `/api/slides/${sid}`, { title: '', body: `!video(${src})`, bg: 'theme-dark' });
    await reload();
  };
  const bigVideo = () => state.settings && state.settings.media_storage;
  $('#vid-hint').innerHTML = bigVideo()
    ? '동영상 파일은 최대 200MB (대용량 저장소 연동됨). 매우 긴 영상은 유튜브(일부공개) 링크를 권장합니다.'
    : '동영상 파일은 25MB 이하. 긴 영상은 유튜브(일부공개) 링크를 쓰세요.';

  $('#vid-url-add').onclick = async () => {
    const url = $('#vid-url').value.trim();
    const msg = $('#vid-msg');
    if (!/^https?:\/\//.test(url)) { msg.textContent = '올바른 주소(http/https)를 입력하세요.'; msg.className = 'msg err'; return; }
    msg.textContent = '추가 중…'; msg.className = 'msg';
    try {
      await addVideoSlide(url);
      $('#vid-url').value = '';
      msg.textContent = '동영상 슬라이드가 추가되었습니다.'; msg.className = 'msg ok';
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
  $('#vid-file-btn').onclick = () => $('#vid-file').click();
  $('#vid-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msg = $('#vid-msg');
    const useStorage = bigVideo();
    const limitMB = useStorage ? 200 : 25;
    if (file.size > limitMB * 1024 * 1024) { msg.textContent = `파일은 ${limitMB}MB 이하여야 합니다.`; msg.className = 'msg err'; e.target.value = ''; return; }
    msg.textContent = '업로드 중…'; msg.className = 'msg';
    try {
      let assetId;
      if (useStorage) {
        // 1) 서명 URL 발급 → 2) Supabase에 직접 PUT → 3) 확인
        const sign = await api('POST', `/api/decks/${id}/media-sign`, { mime: file.type, size: file.size });
        const put = await fetch(sign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'true' }, body: file });
        if (!put.ok) throw new Error('스토리지 업로드에 실패했습니다.');
        const conf = await api('POST', `/api/decks/${id}/media-confirm`, { path: sign.path, mime: file.type });
        assetId = conf.id;
      } else {
        const dataUrl = await fileToDataUrl(file);
        const r = await api('POST', `/api/decks/${id}/asset`, { data: dataUrl });
        assetId = r.id;
      }
      await addVideoSlide(`/api/assets/${assetId}`);
      msg.textContent = '동영상 슬라이드가 추가되었습니다.'; msg.className = 'msg ok';
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
    e.target.value = '';
  };
});

/* ---------------- 사용자 관리 (권한/강사/학생 공용 엔진) ---------------- */
let userTab = 'all';

async function usersPage({ title, description, fixedRole, minLevel }) {
  if (!state.me || level(state.me.role) < minLevel) { location.hash = '#/'; return; }
  const data = await api('GET', '/api/users');
  const myLevel = level(state.me.role);
  const creatable = Object.keys(ROLE_LEVEL).filter((r) => ROLE_LEVEL[r] < myLevel).reverse();
  const roleChoices = fixedRole ? [fixedRole] : creatable;
  const list = data.users.filter((u) =>
    (fixedRole ? u.role === fixedRole : (userTab === 'all' || u.role === userTab)));
  const tabs = fixedRole ? [] : [['all', '전체'], ...creatable.map((r) => [r, ROLE_LABELS[r]])];

  shell(title, `
    <div class="page-head">
      <div><div class="ph-t">${esc(title)}</div><div class="desc">${esc(description)}</div></div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <h2>새 계정 만들기 <span class="sub">자신보다 낮은 권한만 부여할 수 있으며, 첫 로그인 시 비밀번호 변경이 요구됩니다</span></h2>
      <form id="user-form" class="form-grid">
        <div><label>아이디</label><input name="username" required minlength="3" placeholder="영문/숫자 3자 이상"></div>
        <div><label>이름</label><input name="name" required placeholder="홍길동"></div>
        ${fixedRole ? `<input type="hidden" name="role" value="${fixedRole}">` : `
        <div><label>역할(권한)</label>
          <select name="role">${roleChoices.map((r) => `<option value="${r}">${ROLE_LABELS[r]}</option>`).join('')}</select></div>`}
        ${(fixedRole === 'student' || !fixedRole) ? '<div><label>반 (학생만)</label><input name="class_name" placeholder="예: 중1-1반"></div>' : ''}
        <div><label>초기 비밀번호 (8자 이상)</label><input name="password" type="text" required minlength="8"></div>
        <div><button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">${icon('plus')} 계정 생성</button></div>
      </form>
      <div class="msg" id="user-msg"></div>
    </div>
    ${tabs.length ? `<div class="tabs">${tabs.map(([k, label]) => `<button data-tab="${k}" class="${userTab === k ? 'active' : ''}">${label}</button>`).join('')}</div>` : ''}
    <div class="card">
      <div class="tbl-scroll">
        <table class="tbl resp">
          <thead><tr><th>아이디</th><th>이름</th><th>역할</th><th>반</th><th>상태</th><th>생성일</th><th style="width:250px">관리</th></tr></thead>
          <tbody>
            ${list.map((u) => `
              <tr>
                <td data-label="아이디" class="cell-main">${esc(u.username)}</td>
                <td data-label="이름">${esc(u.name)}</td>
                <td data-label="역할"><span class="badge ${u.role === 'superadmin' ? 'violet' : u.role === 'admin' ? 'blue' : u.role === 'instructor' ? 'green' : 'gray'}">${esc(u.roleLabel)}</span></td>
                <td data-label="반">${esc(u.className) || '<span class="muted">-</span>'}</td>
                <td data-label="상태">${u.active ? '<span class="badge green">활성</span>' : '<span class="badge red">비활성</span>'}</td>
                <td data-label="생성일" class="small muted">${esc(u.createdAt).slice(0, 10)}</td>
                <td>
                  ${u.id === state.me.id ? '<span class="small muted">본인 계정</span>'
                    : !u.manageable ? '<span class="small muted">관리 권한 없음</span>' : `
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" data-act="${u.id}" data-val="${u.active ? 0 : 1}">${u.active ? '비활성화' : '활성화'}</button>
                    ${u.role === 'student' ? `<button class="btn btn-ghost btn-sm" data-cls="${u.id}">반 변경</button>` : ''}
                    <button class="btn btn-ghost btn-sm" data-rpw="${u.id}">비번 초기화</button>
                    ${myLevel >= 2 ? `<button class="btn btn-danger btn-sm" data-udel="${u.id}">${icon('trash')}</button>` : ''}
                  </div>`}
                </td>
              </tr>`).join('') || '<tr><td colspan="7" class="empty-note">해당하는 사용자가 없습니다.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`);

  document.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { userTab = b.dataset.tab; navigate(); }; });
  document.getElementById('user-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById('user-msg');
    try {
      await api('POST', '/api/users', {
        username: f.get('username'), name: f.get('name'), role: f.get('role'),
        password: f.get('password'), class_name: f.get('class_name') || '',
      });
      toast('계정이 생성되었습니다.');
      navigate();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
  document.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = async () => { await api('PATCH', `/api/users/${b.dataset.act}`, { active: b.dataset.val === '1' }); navigate(); };
  });
  document.querySelectorAll('[data-cls]').forEach((b) => {
    b.onclick = async () => {
      const v = prompt('새 반 이름을 입력하세요. (예: 중1-2반)');
      if (v === null) return;
      await api('PATCH', `/api/users/${b.dataset.cls}`, { class_name: v });
      navigate();
    };
  });
  document.querySelectorAll('[data-rpw]').forEach((b) => {
    b.onclick = async () => {
      const pw = prompt('새 임시 비밀번호 (8자 이상). 대상자는 첫 로그인 시 변경해야 합니다.');
      if (!pw) return;
      try { await api('POST', `/api/users/${b.dataset.rpw}/reset-password`, { password: pw }); toast('초기화되었습니다.'); }
      catch (err) { toast(err.message, true); }
    };
  });
  document.querySelectorAll('[data-udel]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 계정을 삭제할까요? 되돌릴 수 없습니다.')) return;
      await api('DELETE', `/api/users/${b.dataset.udel}`);
      toast('삭제되었습니다.');
      navigate();
    };
  });
}

route(/^#\/permissions$/, () => usersPage({
  title: '권한 관리', description: '슈퍼관리자 → 관리자 → 강사 → 학생 권한 체계에 따라 계정을 관리합니다.', fixedRole: null, minLevel: 2,
}));
route(/^#\/instructors$/, () => usersPage({
  title: '강사 관리', description: '수업을 운영하는 강사 계정을 관리합니다.', fixedRole: 'instructor', minLevel: 2,
}));
route(/^#\/students$/, () => usersPage({
  title: '학생 관리', description: '학생 계정과 소속 반을 관리합니다. 반은 웹앱 배정의 기준이 됩니다.', fixedRole: 'student', minLevel: 1,
}));
route(/^#\/users$/, () => { location.hash = isAdmin() ? '#/permissions' : '#/students'; });

/* ---------------- 시간표 접근 설정 ---------------- */
route(/^#\/schedules$/, async () => {
  // 강사는 웹앱 허용 시간표를 볼 필요가 없음 → 대시보드로
  if (state.me.role === 'instructor') { location.hash = '#/'; return; }
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
    <div class="card" style="margin-bottom:18px">
      <h2>허용 시간 추가 <span class="sub">학생은 아래 시간에만 접속할 수 있습니다 (${esc(data.now.timezone)} 기준)</span></h2>
      <form id="sched-form" class="form-grid">
        <div><label>요일</label>
          <select name="day_of_week">${DAY_ORDER.map((d) => `<option value="${d}">${DAY_NAMES[d]}요일</option>`).join('')}</select></div>
        <div><label>시작</label><input name="start_time" type="time" value="09:00" required></div>
        <div><label>종료</label><input name="end_time" type="time" value="18:00" required></div>
        <div><label>대상</label>
          <select name="deck_id"><option value="">전체 웹앱</option>${deckOptions}</select></div>
        <div><button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">${icon('plus')} 추가</button></div>
      </form>
      <div class="msg" id="sched-msg"></div>
    </div>` : ''}
    <div class="grid main-cols">
      <div class="card">
        <h2>주간 접근 시간표
          <span class="spacer"></span>
          <span class="sub">현재 ${esc(data.now.dayName)}요일 ${esc(data.now.time)}</span>
          ${data.allowed ? '<span class="badge green">접근 허용</span>' : '<span class="badge red">차단 시간</span>'}
        </h2>
        ${scheduleMatrixHtml(data.windows)}
      </div>
      <div class="card">
        <h2>등록된 허용 시간</h2>
        <div class="win-list">
          ${data.windows.map((w) => `
            <div class="win-row ${w.enabled ? '' : 'off'}">
              <div class="wd">${DAY_NAMES[w.day_of_week]}</div>
              <div>
                <div class="wt">${esc(w.start_time)} ~ ${esc(w.end_time)}</div>
                <div class="wtar">${w.deck_id ? `${esc(w.deck_title || '웹앱')} 전용` : '전체 웹앱 허용'}${w.enabled ? '' : ' · 잠금'}</div>
              </div>
              <div class="spacer"></div>
              ${canEdit ? `
                <button class="btn btn-ghost btn-sm" data-tgl="${w.id}" data-en="${w.enabled ? 0 : 1}">${w.enabled ? '잠금' : '해제'}</button>
                <button class="btn btn-danger btn-sm" data-del-sched="${w.id}">${icon('trash')}</button>` : ''}
            </div>`).join('') || '<div class="empty-note">등록된 허용 시간이 없습니다.</div>'}
        </div>
      </div>
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
      toast('허용 시간이 추가되었습니다.');
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
let logFilter = 'all';
const LOG_FILTERS = {
  all: () => true,
  blocked: (l) => ['time_blocked', 'ip_blocked', 'login_blocked', 'login_failed'].includes(l.action),
  warn: (l) => ['capture_attempt', 'multi_session', 'otp_failed'].includes(l.action),
  ok: (l) => l.action === 'login',
};
route(/^#\/logs$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const data = await api('GET', '/api/logs');
  const list = data.logs.filter(LOG_FILTERS[logFilter] || LOG_FILTERS.all);
  shell('접속 기록', `
    <div class="page-head">
      <div><div class="ph-t">접속 기록 · 보안 로그</div><div class="desc">모든 접속, 차단, 보안 이벤트가 기록됩니다. (최근 300건)</div></div>
    </div>
    <div class="tabs">
      ${[['all', '전체'], ['ok', '정상 접속'], ['blocked', '차단'], ['warn', '보안 경고']].map(([k, label]) =>
        `<button data-lf="${k}" class="${logFilter === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div class="card">${logListHtml(list)}</div>`);
  document.querySelectorAll('[data-lf]').forEach((b) => { b.onclick = () => { logFilter = b.dataset.lf; navigate(); }; });
});

/* ---------------- 리포트 ---------------- */
route(/^#\/report$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const rep = await api('GET', '/api/report');
  // 최근 7일 날짜 축 (빠진 날짜 0으로 채움)
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    days.push(dt.toISOString().slice(0, 10));
  }
  const byDay = Object.fromEntries(rep.daily.map((d) => [d.day, d]));
  const series = days.map((day) => ({ day, ...(byDay[day] || { logins: 0, blocked: 0, captures: 0 }) }));
  const max = Math.max(1, ...series.flatMap((d) => [d.logins, d.blocked, d.captures]));
  const H = 140;
  const bar = (v, cls) => `<div class="bar ${cls}" style="height:${Math.max(3, Math.round((v / max) * H))}px" title="${v}건"></div>`;
  const actionOf = (name) => rep.byAction.find((a) => a.action === name)?.cnt || 0;
  const maxDeck = Math.max(1, ...rep.topDecks.map((d) => d.views));
  const maxStu = Math.max(1, ...rep.activeStudents.map((d) => d.cnt));
  const deckName = (detail) => {
    const m = /title=(.*)$/.exec(detail || '');
    return m ? m[1] : detail;
  };

  shell('리포트', `
    <div class="grid stats">
      <div class="card stat"><div class="tile blue">${icon('clock')}</div><div><div class="lb">누적 정상 접속</div><div class="num">${actionOf('login')}<span class="unit">건</span></div></div></div>
      <div class="card stat"><div class="tile red">${icon('lock')}</div><div><div class="lb">누적 차단 (시간/IP)</div><div class="num">${actionOf('time_blocked') + actionOf('ip_blocked')}<span class="unit">건</span></div></div></div>
      <div class="card stat"><div class="tile orange">${icon('alert')}</div><div><div class="lb">캡처/복제 시도</div><div class="num">${actionOf('capture_attempt')}<span class="unit">건</span></div></div></div>
      <div class="card stat"><div class="tile violet">${icon('key')}</div><div><div class="lb">로그인 실패</div><div class="num">${actionOf('login_failed')}<span class="unit">건</span></div></div></div>
    </div>
    <div class="grid main-cols">
      <div class="card">
        <h2>최근 7일 활동 추이</h2>
        <div class="chart-bars">
          ${series.map((d) => `
            <div class="chart-col">
              <div class="bars">${bar(d.logins, 'b-login')}${bar(d.blocked, 'b-block')}${bar(d.captures, 'b-capture')}</div>
              <div class="cl">${d.day.slice(5).replace('-', '/')}</div>
            </div>`).join('')}
        </div>
        <div class="legend">
          <span><span class="sw" style="background:var(--blue-600)"></span>정상 접속</span>
          <span><span class="sw" style="background:var(--red-600)"></span>차단</span>
          <span><span class="sw" style="background:var(--amber-600)"></span>캡처 시도</span>
        </div>
      </div>
      <div class="col-stack">
        <div class="card">
          <h2>웹앱 열람 순위</h2>
          <div class="rank-list">
            ${rep.topDecks.map((d, i) => `
              <div class="rank-row">
                <span class="rk">${i + 1}</span>
                <span class="rn2">${esc(deckName(d.detail))}</span>
                <div class="rbar" style="width:${Math.round((d.views / maxDeck) * 90)}px"></div>
                <span class="rv">${d.views}회</span>
              </div>`).join('') || '<div class="empty-note">아직 열람 기록이 없습니다.</div>'}
          </div>
        </div>
        <div class="card">
          <h2>주간 활동 학생 TOP 5</h2>
          <div class="rank-list">
            ${rep.activeStudents.map((u, i) => `
              <div class="rank-row">
                <span class="rk">${i + 1}</span>
                <span class="rn2">${esc(u.username)}</span>
                <div class="rbar" style="width:${Math.round((u.cnt / maxStu) * 90)}px"></div>
                <span class="rv">${u.cnt}회</span>
              </div>`).join('') || '<div class="empty-note">최근 7일간 학생 활동이 없습니다.</div>'}
          </div>
        </div>
      </div>
    </div>`);
});

/* ---------------- 검색 ---------------- */
route(/^#\/search\/(.+)$/, async (q) => {
  const query = q.toLowerCase();
  const sections = [];
  const decks = (await api('GET', '/api/decks').catch(() => ({ decks: [] }))).decks
    .filter((d) => `${d.title} ${d.description} ${d.ownerName} ${d.target_classes}`.toLowerCase().includes(query));
  sections.push(['웹앱', decks.map((d) => `
    <div class="log-item"><div class="li-main">
      <div class="li-top">${deckStatusBadge(d)}<a href="#/view/${d.id}" class="li-who">${esc(d.title)}</a></div>
      <div class="li-det">${esc(d.description)} · ${esc(d.ownerName)} 강사 · ${esc(d.target_classes) || '전체'}</div>
    </div></div>`)]);
  if (isStaff()) {
    const users = (await api('GET', '/api/users').catch(() => ({ users: [] }))).users
      .filter((u) => `${u.username} ${u.name} ${u.roleLabel} ${u.className}`.toLowerCase().includes(query));
    sections.push(['사용자', users.map((u) => `
      <div class="log-item"><div class="li-main">
        <div class="li-top"><span class="badge blue">${esc(u.roleLabel)}</span><span class="li-who">${esc(u.name)} (${esc(u.username)})</span></div>
        <div class="li-det">${esc(u.className) || ''} ${u.active ? '' : '· 비활성'}</div>
      </div></div>`)]);
  }
  if (isAdmin()) {
    const logs = (await api('GET', '/api/logs').catch(() => ({ logs: [] }))).logs
      .filter((l) => `${l.username} ${l.action} ${l.detail}`.toLowerCase().includes(query)).slice(0, 30);
    sections.push(['로그', logs.map((l) => {
      const [label, color] = LOG_LABELS[l.action] || [l.action, 'gray'];
      return `<div class="log-item"><div class="li-main">
        <div class="li-top"><span class="badge ${color}">${esc(label)}</span><span class="li-who">${esc(l.username || '-')}</span></div>
        <div class="li-det">${esc(l.detail)}</div></div>
        <div class="li-meta">${esc(l.created_at)}</div></div>`;
    })]);
  }
  shell(`검색: ${q}`, `
    <div class="page-head"><div><div class="ph-t">"${esc(q)}" 검색 결과</div></div></div>
    <div class="col-stack">
      ${sections.map(([name, items]) => `
        <div class="card"><h2>${name} <span class="sub">${items.length}건</span></h2>
          ${items.length ? `<div class="log-list">${items.join('')}</div>` : '<div class="empty-note">결과가 없습니다.</div>'}
        </div>`).join('')}
    </div>`);
});

/* ---------------- 설정 / 비밀번호 ---------------- */
function passwordCardHtml(forced) {
  return `
    <div class="card" style="max-width:460px">
      <h2>비밀번호 변경</h2>
      ${forced ? '<p class="msg err" style="margin-bottom:12px">보안을 위해 비밀번호를 변경해야 서비스를 이용할 수 있습니다.</p>' : ''}
      <form id="pw-form" class="form-grid" style="grid-template-columns:1fr">
        <div><label>현재 비밀번호</label><input name="current" type="password" required autocomplete="current-password"></div>
        <div><label>새 비밀번호 (8자 이상)</label><input name="next" type="password" required minlength="8" autocomplete="new-password"></div>
        <div><label>새 비밀번호 확인</label><input name="next2" type="password" required minlength="8" autocomplete="new-password"></div>
        <button class="btn btn-primary" type="submit" style="justify-content:center">변경하기</button>
      </form>
      <div class="msg" id="pw-msg"></div>
    </div>`;
}
function bindPasswordForm() {
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
      toast('비밀번호가 변경되었습니다.');
      setTimeout(() => { location.hash = isStaff() ? '#/' : '#/decks'; }, 500);
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
}

route(/^#\/password$/, async () => {
  shell('비밀번호 변경', passwordCardHtml(state.me.mustChangePassword));
  bindPasswordForm();
});

route(/^#\/settings$/, async () => {
  const u = state.me;
  shell('설정', `
    <div class="grid main-cols">
      <div class="col-stack">
        <div class="card">
          <h2>내 정보</h2>
          <div class="preview-kv" style="grid-template-columns:110px 1fr">
            <span class="k">이름</span><span class="v">${esc(u.name)}</span>
            <span class="k">아이디</span><span class="v">${esc(u.username)}</span>
            <span class="k">역할</span><span><span class="badge blue">${esc(u.roleLabel)}</span></span>
            ${u.className ? `<span class="k">소속 반</span><span class="v">${esc(u.className)}</span>` : ''}
            ${isAdmin() && state.settings?.two_factor ? `<span class="k">2단계 인증</span><span>${u.totpEnabled ? '<span class="badge green">등록됨</span>' : '<span class="badge amber">다음 로그인 시 등록</span>'}</span>` : ''}
          </div>
        </div>
        ${passwordCardHtml(false)}
      </div>
      <div class="card">
        <h2>서비스 정보</h2>
        <div class="preview-kv" style="grid-template-columns:110px 1fr">
          <span class="k">서비스</span><span class="v">AI 온라인 플랫폼 관리자</span>
          <span class="k">기준 시간대</span><span class="v">${esc(state.access?.now.timezone || 'Asia/Seoul')}</span>
          <span class="k">접근 상태</span><span>${state.access?.allowed ? '<span class="badge green">허용 시간</span>' : '<span class="badge red">차단 시간</span>'}</span>
        </div>
        <p class="small muted mt" style="line-height:1.9">
          진로교육 PPT 웹앱 · 권한 및 접근 관리 시스템입니다.
          운영 문의는 소속 기관의 관리자에게 연락하세요.
        </p>
      </div>
    </div>`);
  bindPasswordForm();
});

/* ---------------- 계약서 인쇄·다운로드 (동의 전 사전 검토용) ---------------- */
// 계약 본문을 인쇄 친화적인 독립 HTML 문서로 만든다(앱 인쇄 차단과 무관하게 파일/iframe에서 동작).
function agreementDocHtml(text, version) {
  const lines = String(text || '').split('\n');
  const title = (lines[0] || '이용·비밀유지 계약서').trim();
  const body = lines.slice(1).join('\n').trim();
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} (버전 ${esc(version)})</title>
<style>
  @page { margin: 20mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    color: #1a1a1a; line-height: 1.9; font-size: 12pt; max-width: 780px; margin: 32px auto; padding: 0 20px; }
  h1 { font-size: 17pt; text-align: center; margin: 0 0 4px; }
  .ver { text-align: center; color: #666; font-size: 10pt; margin-bottom: 28px; }
  .doc { white-space: pre-wrap; word-break: keep-all; }
  .sign { margin-top: 40px; border-top: 1px solid #ccc; padding-top: 18px; page-break-inside: avoid; }
  .sign .note { color: #666; font-size: 10pt; margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 12px 10px; font-size: 11pt; text-align: left; }
  th { background: #f3f3f3; white-space: nowrap; }
  td { height: 46px; }
  .bar { text-align: center; margin-bottom: 24px; }
  .bar button { font: inherit; padding: 9px 18px; border: 1px solid #2563eb; background: #2563eb;
    color: #fff; border-radius: 8px; cursor: pointer; }
  @media print { .bar { display: none; } body { margin: 0; } }
</style></head>
<body>
  <div class="bar"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>
  <h1>${esc(title)}</h1>
  <div class="ver">버전 ${esc(version)}</div>
  <div class="doc">${esc(body)}</div>
  <div class="sign">
    <p class="note">※ 본 인쇄본은 사전 검토·보관용입니다. 실제 동의는 플랫폼 로그인 후 전자적 방식으로 이루어지며, 전자 동의는 서명과 동일한 효력을 가집니다.</p>
    <table>
      <tr><th>구분</th><th>성명</th><th>날짜</th><th>서명</th></tr>
      <tr><td>회사(플랫폼)</td><td></td><td></td><td></td></tr>
      <tr><td>이용자(관리자·강사)</td><td></td><td></td><td></td></tr>
    </table>
  </div>
</body></html>`;
}

function downloadAgreement(text, version) {
  const blob = new Blob([agreementDocHtml(text, version)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `플랫폼_이용계약서_v${version}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('계약서를 다운로드했습니다. 파일을 열어 인쇄하거나 PDF로 저장하세요.');
}

function printAgreement(text, version) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  iframe.onload = () => {
    const w = iframe.contentWindow;
    let done = false;
    const cleanup = () => { if (done) return; done = true; setTimeout(() => iframe.remove(), 300); };
    w.onafterprint = cleanup;
    w.focus();
    w.print();
    setTimeout(cleanup, 60000);
  };
  iframe.srcdoc = agreementDocHtml(text, version);
  document.body.appendChild(iframe);
}

/* ---------------- 계약·보안 동의 (강사·관리자 강제) ---------------- */
route(/^#\/agreement$/, async () => {
  if (!isStaff()) { location.hash = '#/'; return; }
  const ag = await api('GET', '/api/agreement');
  shell('계약 및 보안 동의', `
    <div class="card" style="max-width:760px;margin:0 auto">
      <h2>${icon('shield')} 이용·비밀유지 계약 동의 <span class="sub">버전 ${ag.version}</span></h2>
      <p class="small muted" style="margin-bottom:12px">플랫폼 이용을 위해 아래 계약·보안 조항에 동의해 주세요. 전자적 동의는 서명과 동일한 효력을 가집니다. 동의 전에 계약서를 <b>다운로드하거나 인쇄</b>해 검토하실 수 있습니다.</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px">
        <button class="btn btn-ghost btn-sm" type="button" id="ag-download">${icon('download')} 다운로드</button>
        <button class="btn btn-ghost btn-sm" type="button" id="ag-print">${icon('fileText')} 인쇄 / PDF</button>
      </div>
      <div class="agreement-doc">${esc(ag.text).replace(/\n/g, '<br>')}</div>
      <form id="agree-form" class="mt">
        <label style="display:flex;gap:9px;align-items:flex-start;cursor:pointer;font-weight:600">
          <input type="checkbox" name="consent" style="width:17px;height:17px;margin-top:1px;accent-color:var(--blue-600)">
          <span>위 계약 및 비밀유지·보안 조항을 모두 읽고 이해하였으며 이에 동의합니다.</span>
        </label>
        <div class="form-grid mt" style="grid-template-columns:1fr auto;max-width:420px">
          <div><label>동의자 성명 (서명)</label><input name="name" value="${esc(state.me.name)}" required></div>
          <div style="align-self:end"><button class="btn btn-primary" type="submit">동의하고 시작</button></div>
        </div>
        <div class="msg" id="agree-msg"></div>
      </form>
    </div>`);
  document.getElementById('ag-download').onclick = () => downloadAgreement(ag.text, ag.version);
  document.getElementById('ag-print').onclick = () => printAgreement(ag.text, ag.version);
  document.getElementById('agree-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById('agree-msg');
    if (!f.get('consent')) { msg.textContent = '동의 체크가 필요합니다.'; msg.className = 'msg err'; return; }
    try {
      await api('POST', '/api/agree', { consent: true, name: f.get('name') });
      state.mustAgree = false;
      state.me.agreedVersion = ag.version;
      toast('동의가 완료되었습니다.');
      location.hash = isStaff() ? '#/' : '#/decks';
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
});

/* ---------------- 계약 관리 (슈퍼관리자) ---------------- */
route(/^#\/contract$/, async () => {
  if (!state.me || state.me.role !== 'superadmin') { location.hash = '#/'; return; }
  const data = await api('GET', '/api/agreement/admin');
  shell('계약 관리', `
    <div class="grid main-cols">
      <div class="card">
        <h2>계약·보안 동의서 편집 <span class="sub">현재 버전 ${data.version}</span></h2>
        ${data.defaultIsNewer ? `<div class="msg" style="background:var(--amber-50,#fff7ed);border:1px solid var(--amber-300,#fcd34d);color:var(--amber-700,#b45309);padding:9px 12px;border-radius:9px;margin-bottom:10px;font-size:13px;font-weight:600">📢 코드에 최신 기본 계약 문안이 있습니다. 아래 <b>"최신 기본 문안 불러오기"</b>를 누른 뒤 <b>저장</b>하면 사이트에 반영됩니다(전원 재동의).</div>` : ''}
        <textarea id="ct-text" class="input" rows="22" style="line-height:1.7">${esc(data.text)}</textarea>
        <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:600;font-size:13px">
          <input type="checkbox" id="ct-required" ${data.required ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--blue-600)">
          강사·관리자 최초 이용 시 동의 요구
        </label>
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-weight:600;font-size:13px;color:var(--amber-600)">
          <input type="checkbox" id="ct-bump" style="width:16px;height:16px;accent-color:var(--amber-600)">
          개정으로 저장 (버전 올림 → 전원 재동의 요구)
        </label>
        <div class="mt" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn btn-primary" id="ct-save">저장</button>
          <button class="btn btn-ghost" type="button" id="ct-load-default">↻ 최신 기본 문안 불러오기</button>
          <button class="btn btn-ghost" type="button" id="ct-download">${icon('download')} 다운로드</button>
          <button class="btn btn-ghost" type="button" id="ct-print">${icon('fileText')} 인쇄 / PDF</button>
          <span class="msg" id="ct-msg"></span></div>
      </div>
      <div class="col-stack">
        <div class="card">
          <h2>미동의 대상 <span class="sub">${data.pending.length}명</span></h2>
          ${data.pending.length ? `<div class="log-list">${data.pending.map((p) => `
            <div class="log-item"><div class="li-main"><div class="li-top"><span class="badge amber">미동의</span>
              <span class="li-who">${esc(p.name)} (${esc(p.username)})</span></div>
              <div class="li-det">${esc(ROLE_LABELS[p.role] || p.role)}</div></div></div>`).join('')}</div>`
            : '<div class="empty-note">모든 대상이 동의했습니다.</div>'}
        </div>
        <div class="card">
          <h2>동의 기록 <span class="sub">최근 ${data.records.length}건</span></h2>
          ${data.records.length ? `<div class="log-list">${data.records.map((r) => `
            <div class="log-item"><div class="li-main"><div class="li-top"><span class="badge green">서명 v${r.version}</span>
              <span class="li-who">${esc(r.signed_name)}</span> <span class="small muted">${esc(r.username)}</span></div></div>
              <div class="li-meta">${esc(r.agreed_at)}<br>${esc(r.ip || '')}</div></div>`).join('')}</div>`
            : '<div class="empty-note">동의 기록이 없습니다.</div>'}
        </div>
      </div>
    </div>`);
  document.getElementById('ct-load-default').onclick = () => {
    document.getElementById('ct-text').value = data.default;
    const bump = document.getElementById('ct-bump');
    if (bump) bump.checked = true;
    const msg = document.getElementById('ct-msg');
    msg.textContent = '최신 기본 문안을 불러왔습니다. 확인 후 [저장]을 누르면 사이트에 반영되고 전원 재동의가 요청됩니다.';
    msg.className = 'msg';
    toast('최신 기본 문안을 불러왔습니다.');
  };
  document.getElementById('ct-download').onclick = () => downloadAgreement(document.getElementById('ct-text').value, data.version);
  document.getElementById('ct-print').onclick = () => printAgreement(document.getElementById('ct-text').value, data.version);
  document.getElementById('ct-save').onclick = async () => {
    const msg = document.getElementById('ct-msg');
    try {
      await api('PATCH', '/api/agreement/admin', {
        text: document.getElementById('ct-text').value,
        required: document.getElementById('ct-required').checked,
        bump: document.getElementById('ct-bump').checked,
      });
      toast('저장되었습니다.');
      navigate();
    } catch (err) { msg.textContent = err.message; msg.className = 'msg err'; }
  };
});

/* ---------------- 삭제 요청 승인 (슈퍼관리자) ---------------- */
route(/^#\/deletions$/, async () => {
  if (!state.me || state.me.role !== 'superadmin') { location.hash = '#/'; return; }
  const data = await api('GET', '/api/deletion-requests');
  shell('삭제 요청 승인', `
    <div class="page-head"><div><div class="ph-t">자료 삭제 요청</div>
      <div class="desc">강사·관리자가 본인 자료 삭제를 요청하면 여기서 승인·반려합니다. 승인해야 실제 삭제됩니다.</div></div></div>
    <div class="card">
      <div class="tbl-scroll"><table class="tbl resp">
        <thead><tr><th>자료</th><th>요청자</th><th>사유</th><th>요청 시각</th><th style="width:180px">처리</th></tr></thead>
        <tbody>
          ${data.requests.map((r) => `<tr>
            <td data-label="자료" class="cell-main">${esc(r.title)}</td>
            <td data-label="요청자">${esc(r.requester_name || '-')} <span class="small muted">${esc(r.requester_username || '')}</span></td>
            <td data-label="사유">${esc(r.delete_reason) || '<span class="muted">-</span>'}</td>
            <td data-label="요청 시각" class="small muted">${esc(r.requested_at)}</td>
            <td><div class="row-actions">
              <button class="btn btn-danger btn-sm" data-approve="${r.id}">승인(삭제)</button>
              <button class="btn btn-ghost btn-sm" data-reject="${r.id}">반려</button>
            </div></td>
          </tr>`).join('') || '<tr><td colspan="5" class="empty-note">대기 중인 삭제 요청이 없습니다.</td></tr>'}
        </tbody>
      </table></div>
    </div>`);
  document.querySelectorAll('[data-approve]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 자료를 영구 삭제할까요? 되돌릴 수 없습니다.')) return;
      await api('POST', `/api/decks/${b.dataset.approve}/delete-approve`);
      toast('삭제되었습니다.');
      navigate();
    };
  });
  document.querySelectorAll('[data-reject]').forEach((b) => {
    b.onclick = async () => {
      await api('POST', `/api/decks/${b.dataset.reject}/delete-reject`);
      toast('반려되었습니다.');
      navigate();
    };
  });
});

/* ---------------- 과정·강사배정 (관리자 이상) ---------------- */
route(/^#\/courses$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const [cData, dData, uData] = await Promise.all([
    api('GET', '/api/courses'),
    api('GET', '/api/decks'),
    api('GET', '/api/users'),
  ]);
  const decks = dData.decks;
  const instructors = uData.users.filter((u) => ['instructor', 'admin'].includes(u.role) && u.id !== state.me.id);
  const deckById = (id) => decks.find((d) => d.id === id);

  const courseCard = (c) => {
    const assignedIds = new Set(c.instructors.map((i) => i.id));
    const itemIds = new Set(c.items.map((i) => i.deckId));
    const addable = decks.filter((d) => !itemIds.has(d.id));
    const assignable = instructors.filter((i) => !assignedIds.has(i.id));
    return `
    <div class="card" data-course="${c.id}" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div><h2 style="margin:0">📚 ${esc(c.name)}</h2><div class="small muted">${esc(c.description) || '설명 없음'}</div></div>
        <button class="btn btn-ghost btn-sm" data-course-del="${c.id}">${icon('trash')} 과정 삭제</button>
      </div>

      <div class="grid main-cols mt">
        <div>
          <div class="field-label">자료 구성 <span class="sub">필수는 자동 배정, 선택은 강사가 담습니다</span></div>
          <div class="tbl-scroll"><table class="tbl">
            <tbody>
              ${c.items.map((it) => `<tr>
                <td>${it.costType === 'api_paid' ? '💳 ' : '🆓 '}${esc(it.title)}</td>
                <td style="width:150px">
                  <select data-req-course="${c.id}" data-req-deck="${it.deckId}" class="input">
                    <option value="1" ${it.required ? 'selected' : ''}>필수</option>
                    <option value="0" ${!it.required ? 'selected' : ''}>선택</option>
                  </select></td>
                <td style="width:40px"><button class="btn btn-ghost btn-sm" data-item-del="${c.id}:${it.deckId}" title="빼기">✕</button></td>
              </tr>`).join('') || '<tr><td colspan="3" class="empty-note">담긴 자료가 없습니다.</td></tr>'}
            </tbody>
          </table></div>
          ${addable.length ? `<div style="display:flex;gap:6px;margin-top:8px">
            <select class="input" data-add-deck="${c.id}" style="flex:1">
              ${addable.map((d) => `<option value="${d.id}">${d.costType === 'api_paid' ? '💳 ' : '🆓 '}${esc(d.title)}</option>`).join('')}
            </select>
            <select class="input" data-add-req="${c.id}" style="width:90px"><option value="1">필수</option><option value="0">선택</option></select>
            <button class="btn btn-soft btn-sm" data-add-item="${c.id}">추가</button>
          </div>` : '<div class="small muted" style="margin-top:8px">모든 자료가 이미 담겨 있습니다.</div>'}
        </div>

        <div class="col-stack">
          <div class="field-label">담당 강사배정</div>
          <div>${c.instructors.map((i) => `<span class="badge blue" style="margin:0 6px 6px 0">${esc(i.name)}
            <a data-unassign="${c.id}:${i.id}" style="cursor:pointer;margin-left:4px">✕</a></span>`).join('') || '<span class="small muted">아직 배정된 강사가 없습니다.</span>'}</div>
          ${assignable.length ? `<div style="display:flex;gap:6px;margin-top:8px">
            <select class="input" data-assign-inst="${c.id}" style="flex:1">
              ${assignable.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(ROLE_LABELS[i.role] || i.role)})</option>`).join('')}
            </select>
            <button class="btn btn-soft btn-sm" data-do-assign="${c.id}">배정</button>
          </div>` : ''}
          <div class="small muted" style="margin-top:8px;line-height:1.6">
            💡 API 유료 자료가 포함된 과정은 사용량이 <b>종량 정산</b>에 집계됩니다.
          </div>
        </div>
      </div>
    </div>`;
  };

  shell('과정·강사배정', `
    <div class="page-head">
      <div><div class="ph-t">과정(패키지) 관리</div>
        <div class="desc">수업의뢰 단위로 자료를 묶고(필수/선택), 강사를 배정합니다. 강사는 필수 자료를 자동으로 받고 선택 자료는 직접 담습니다.</div></div>
    </div>
    <div class="card" style="margin-bottom:18px">
      <h2>새 과정 만들기</h2>
      <form id="course-form" class="form-grid">
        <div><label>과정 이름</label><input name="name" required placeholder="예: 베이킹 기초 (8차시)"></div>
        <div><label>설명</label><input name="description" placeholder="예: AI 베이킹 진로 체험 과정"></div>
        <div style="align-self:end"><button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">${icon('plus')} 과정 생성</button></div>
      </form>
      <div class="msg" id="course-msg"></div>
    </div>
    ${cData.courses.map(courseCard).join('') || '<p class="empty-note">아직 과정이 없습니다. 위에서 만들어 보세요.</p>'}`);

  document.getElementById('course-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('POST', '/api/courses', { name: f.get('name'), description: f.get('description') });
      toast('과정이 생성되었습니다.'); navigate();
    } catch (err) { const m = document.getElementById('course-msg'); m.textContent = err.message; m.className = 'msg err'; }
  };
  document.querySelectorAll('[data-course-del]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('이 과정을 삭제할까요? (자료 자체는 삭제되지 않습니다)')) return;
      await api('DELETE', `/api/courses/${b.dataset.courseDel}`); toast('삭제되었습니다.'); navigate();
    };
  });
  document.querySelectorAll('[data-add-item]').forEach((b) => {
    b.onclick = async () => {
      const cid = b.dataset.addItem;
      const deckId = Number(document.querySelector(`[data-add-deck="${cid}"]`).value);
      const required = document.querySelector(`[data-add-req="${cid}"]`).value === '1';
      await api('POST', `/api/courses/${cid}/items`, { deck_id: deckId, required }); navigate();
    };
  });
  document.querySelectorAll('[data-req-course]').forEach((s) => {
    s.onchange = async () => {
      await api('POST', `/api/courses/${s.dataset.reqCourse}/items`, { deck_id: Number(s.dataset.reqDeck), required: s.value === '1' });
      toast('변경되었습니다.');
    };
  });
  document.querySelectorAll('[data-item-del]').forEach((b) => {
    b.onclick = async () => {
      const [cid, did] = b.dataset.itemDel.split(':');
      await api('DELETE', `/api/courses/${cid}/items/${did}`); navigate();
    };
  });
  document.querySelectorAll('[data-do-assign]').forEach((b) => {
    b.onclick = async () => {
      const cid = b.dataset.doAssign;
      const instId = Number(document.querySelector(`[data-assign-inst="${cid}"]`).value);
      await api('POST', `/api/courses/${cid}/instructors`, { instructor_id: instId }); toast('배정되었습니다.'); navigate();
    };
  });
  document.querySelectorAll('[data-unassign]').forEach((a) => {
    a.onclick = async () => {
      const [cid, iid] = a.dataset.unassign.split(':');
      await api('DELETE', `/api/courses/${cid}/instructors/${iid}`); navigate();
    };
  });
});

/* ---------------- 내 과정 (강사) ---------------- */
route(/^#\/my-courses$/, async () => {
  if (!state.me || state.me.role !== 'instructor') { location.hash = '#/'; return; }
  const data = await api('GET', '/api/my-courses');
  const itemRow = (it, extra = '') => `
    <div class="log-item"><div class="li-main"><div class="li-top">
      <span class="badge ${it.costType === 'api_paid' ? 'amber' : 'green'} plain">${it.costType === 'api_paid' ? '💳 유료' : '🆓 무료'}</span>
      <span class="li-who">${esc(it.title)}</span></div>
      ${it.costType === 'api_paid' && it.unitCost ? `<div class="li-det small muted">사용 시 약 ${Number(it.unitCost).toLocaleString()}원/회 과금</div>` : ''}</div>
      <div class="li-meta">${extra}</div></div>`;
  shell('내 과정', `
    <div class="page-head"><div><div class="ph-t">내게 배정된 과정</div>
      <div class="desc">필수 자료는 자동으로 제공되고, 선택 자료는 "담기"로 추가하면 웹앱/PPT 관리에 나타납니다.</div></div></div>
    ${data.courses.map((c) => `
      <div class="card" style="margin-bottom:16px">
        <h2 style="margin-top:0">📚 ${esc(c.name)}</h2>
        <div class="small muted">${esc(c.description) || ''}</div>
        <div class="grid main-cols mt">
          <div>
            <div class="field-label">필수 자료 <span class="sub">항상 사용 가능</span></div>
            ${c.required.map((it) => itemRow(it, '<span class="badge blue">필수</span>')).join('') || '<div class="empty-note">필수 자료 없음</div>'}
          </div>
          <div>
            <div class="field-label">선택 가능 자료 <span class="sub">필요한 것만 담기</span></div>
            ${c.optional.map((it) => itemRow(it, it.opted
              ? `<button class="btn btn-ghost btn-sm" data-optout="${c.id}:${it.deckId}">담기 취소</button>`
              : `<button class="btn btn-soft btn-sm" data-optin="${c.id}:${it.deckId}">＋ 담기</button>`)).join('') || '<div class="empty-note">선택 자료 없음</div>'}
          </div>
        </div>
      </div>`).join('') || '<p class="empty-note">아직 배정된 과정이 없습니다. 관리자에게 문의하세요.</p>'}`);
  document.querySelectorAll('[data-optin]').forEach((b) => {
    b.onclick = async () => {
      const [cid, did] = b.dataset.optin.split(':');
      await api('POST', `/api/courses/${cid}/opt-in`, { deck_id: Number(did) }); toast('자료를 담았습니다.'); navigate();
    };
  });
  document.querySelectorAll('[data-optout]').forEach((b) => {
    b.onclick = async () => {
      const [cid, did] = b.dataset.optout.split(':');
      await api('DELETE', `/api/courses/${cid}/opt-in/${did}`); toast('담기를 취소했습니다.'); navigate();
    };
  });
});

/* ---------------- 종량 정산 (관리자 이상) ---------------- */
let billingMonth = '';
let billingGroup = 'deck';
route(/^#\/billing$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const params = [`group=${billingGroup}`];
  if (billingMonth) params.push(`month=${billingMonth}`);
  const data = await api('GET', `/api/billing?${params.join('&')}`);
  const G = billingGroup;
  const firstCol = G === 'instructor' ? '강사' : G === 'session' ? '수업(차시)' : '자료';
  const groupTabs = [['deck', '자료별'], ['instructor', '강사별'], ['session', '수업별']];
  const head = G === 'deck'
    ? `<th>${firstCol}</th><th>API 제공자</th><th>예상 단가</th><th>호출수(실호출)</th><th>이용 학생</th><th>예상 비용</th>`
    : `<th>${firstCol}</th><th>${G === 'instructor' ? '아이디' : '담당 강사'}</th><th>자료 수</th><th>호출수(실호출)</th><th>이용 학생</th><th>예상 비용</th>`;
  const rowHtml = (i) => G === 'deck'
    ? `<tr>
        <td data-label="${firstCol}" class="cell-main">💳 ${esc(i.title)}</td>
        <td data-label="제공자">${esc(i.subtitle) || '<span class="muted">-</span>'}</td>
        <td data-label="예상 단가">${i.unitCost ? `${Number(i.unitCost).toLocaleString()}원/회` : '<span class="muted">미설정</span>'}</td>
        <td data-label="호출수">${i.calls.toLocaleString()} <span class="small muted">(${i.apiCalls.toLocaleString()})</span></td>
        <td data-label="이용 학생">${i.learners.toLocaleString()}명</td>
        <td data-label="예상 비용"><b>${Number(i.estCost).toLocaleString()}원</b></td>
      </tr>`
    : `<tr>
        <td data-label="${firstCol}" class="cell-main">${G === 'instructor' ? '👤 ' : '📆 '}${esc(i.title)}</td>
        <td data-label="${G === 'instructor' ? '아이디' : '담당'}">${esc(i.subtitle) || '<span class="muted">-</span>'}</td>
        <td data-label="자료 수">${(i.decks ?? 0).toLocaleString()}개</td>
        <td data-label="호출수">${i.calls.toLocaleString()} <span class="small muted">(${i.apiCalls.toLocaleString()})</span></td>
        <td data-label="이용 학생">${i.learners.toLocaleString()}명</td>
        <td data-label="예상 비용"><b>${Number(i.estCost).toLocaleString()}원</b></td>
      </tr>`;
  shell('종량 정산', `
    <div class="page-head">
      <div><div class="ph-t">API 유료 자료 종량 정산</div>
        <div class="desc">수업·강사별로 실제 API 사용량을 집계합니다. 예상 비용 = Σ(호출수 × 자료 단가). 괄호 안은 앱이 보고한 실제 API 호출수(그 외는 열람 기준).</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="month" class="input" id="bm" value="${esc(billingMonth)}">
        <button class="btn btn-ghost btn-sm" id="bm-all">전체 기간</button>
      </div>
    </div>
    <div class="tabs">
      ${groupTabs.map(([k, label]) => `<button data-gtab="${k}" class="${billingGroup === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div class="card">
      <div class="tbl-scroll"><table class="tbl resp">
        <thead><tr>${head}</tr></thead>
        <tbody>
          ${data.items.map(rowHtml).join('') || `<tr><td colspan="6" class="empty-note">${G === 'session' ? '수업(입장 코드) 단위의 API 사용 기록이 없습니다.' : 'API 유료 자료의 사용 기록이 없습니다.'}</td></tr>`}
        </tbody>
        ${data.items.length ? `<tfoot><tr><td colspan="5" style="text-align:right"><b>합계</b></td><td><b>${Number(data.total).toLocaleString()}원</b></td></tr></tfoot>` : ''}
      </table></div>
      <div class="small muted" style="margin-top:10px;line-height:1.7">
        ${billingMonth ? `<b>${esc(billingMonth)}</b> 기준` : '<b>전체 기간</b> 기준'} 집계입니다.
        정확한 호출량 집계를 위해서는 외부 웹앱에 "링크 설정 → 사용량 보고 스니펫"을 넣어 API 호출 시마다 보고하도록 하세요.
        단가 미설정 자료는 "💳 요금"에서 1회 원가를 입력하면 예상 비용이 계산됩니다.
      </div>
    </div>`);
  document.getElementById('bm').onchange = (e) => { billingMonth = e.target.value; navigate(); };
  document.getElementById('bm-all').onclick = () => { billingMonth = ''; navigate(); };
  document.querySelectorAll('[data-gtab]').forEach((b) => { b.onclick = () => { billingGroup = b.dataset.gtab; navigate(); }; });
});

/* ---------------- 정산 (청구 배분) — 관리자 이상 ---------------- */
let settleMonth = new Date().toISOString().slice(0, 7);
let settleGroup = 'instructor';
route(/^#\/settlement$/, async () => {
  if (!isAdmin()) { location.hash = '#/'; return; }
  const data = await api('GET', `/api/settlements?month=${settleMonth}&group=${settleGroup}`);
  const groupTabs = [['instructor', '강사별'], ['session', '수업별'], ['deck', '자료별']];
  const gLabel = { instructor: '강사', session: '수업(차시)', deck: '자료' }[settleGroup];

  const provCard = (p) => `
    <div class="card" data-prov="${esc(p.provider)}" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">🧾 ${esc(p.providerLabel)}</h2>
          <div class="small muted">${settleMonth} · 총 호출 ${p.totalCalls.toLocaleString()}회
            ${p.confirmed ? '<span class="badge green">정산 확정</span>' : p.invoiceAmount != null ? '<span class="badge amber">미확정</span>' : '<span class="badge gray">청구액 미입력</span>'}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          <div><label class="small muted">실제 청구액(원)</label><br>
            <input class="input" type="number" min="0" data-inv-amt style="width:150px" value="${p.invoiceAmount != null ? p.invoiceAmount : ''}" placeholder="예: 34000"></div>
          <div><label class="small muted">메모</label><br>
            <input class="input" data-inv-note style="width:160px" value="${esc(p.note || '')}" placeholder="청구서 번호 등"></div>
          <label class="small" style="display:flex;gap:5px;align-items:center;padding-bottom:9px"><input type="checkbox" data-inv-confirm ${p.confirmed ? 'checked' : ''}> 확정</label>
          <button class="btn btn-primary btn-sm" data-inv-save>저장</button>
          ${p.invoiceId ? `<button class="btn btn-ghost btn-sm" data-inv-del="${p.invoiceId}">삭제</button>` : ''}
        </div>
      </div>
      ${p.totalCalls === 0 ? '<div class="empty-note">이 프로바이더의 사용 기록이 없어 배분할 수 없습니다.</div>' : `
      <div class="tbl-scroll mt"><table class="tbl resp">
        <thead><tr><th>${gLabel}</th><th>${settleGroup === 'instructor' ? '아이디' : settleGroup === 'session' ? '담당' : ''}</th><th>호출수(실호출)</th><th>비율</th><th>배분액</th></tr></thead>
        <tbody>
          ${p.rows.map((r) => `<tr>
            <td class="cell-main">${settleGroup === 'instructor' ? '👤 ' : settleGroup === 'session' ? '📆 ' : '💳 '}${esc(r.title)}</td>
            <td>${esc(r.subtitle) || '<span class="muted">-</span>'}</td>
            <td>${r.calls.toLocaleString()} <span class="small muted">(${r.apiCalls.toLocaleString()})</span></td>
            <td>${(r.ratio * 100).toFixed(1)}%</td>
            <td><b>${r.amount != null ? Number(r.amount).toLocaleString() + '원' : '<span class="muted">청구액 입력 시</span>'}</b></td>
          </tr>`).join('')}
        </tbody>
        ${p.invoiceAmount != null ? `<tfoot><tr><td colspan="4" style="text-align:right"><b>합계 (= 청구액)</b></td><td><b>${Number(p.invoiceAmount).toLocaleString()}원</b></td></tr></tfoot>` : ''}
      </table></div>`}
    </div>`;

  shell('정산 (청구 배분)', `
    <div class="page-head">
      <div><div class="ph-t">정산 — 실제 청구액 배분</div>
        <div class="desc">프로바이더 실제 청구액을 입력하면, 측정된 호출 비율로 강사·수업·자료에 자동 배분합니다. 총액은 청구서와 정확히 일치합니다.</div></div>
      <div><input type="month" class="input" id="sm" value="${esc(settleMonth)}"></div>
    </div>
    <div class="tabs">
      ${groupTabs.map(([k, label]) => `<button data-sgtab="${k}" class="${settleGroup === k ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div class="card" style="margin-bottom:16px;background:var(--surface-2,rgba(127,127,127,.04))">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><b>${esc(settleMonth)} 정산 총액</b> <span class="small muted">(입력된 청구액 합계)</span></div>
        <div style="font-size:20px;font-weight:800">${Number(data.grandInvoice).toLocaleString()}원</div>
      </div>
    </div>
    ${data.providers.length ? data.providers.map(provCard).join('') : '<p class="empty-note">이 달에 API 유료 자료 사용 기록이 없습니다.</p>'}
    <div class="card">
      <div class="small muted" style="line-height:1.8">
        <b>정산 방식</b> — 각 프로바이더(OpenAI 등)의 실제 청구서 금액을 입력하면,
        그 프로바이더 자료의 <b>측정된 호출 비율</b>대로 대상에 배분합니다.
        고정 예상단가와 달리 <b>총액이 청구서와 정확히 일치</b>하고, 배분 비율만 실제 사용량을 따릅니다.
        <br>정확도를 높이려면 유료 앱에 "링크 설정 → 사용량 보고 스니펫"을 넣어 실호출을 보고하게 하세요
        (미보고 자료는 열람 1회=1호출로 추정 배분).
      </div>
    </div>`);

  document.getElementById('sm').onchange = (e) => { settleMonth = e.target.value || settleMonth; navigate(); };
  document.querySelectorAll('[data-sgtab]').forEach((b) => { b.onclick = () => { settleGroup = b.dataset.sgtab; navigate(); }; });
  document.querySelectorAll('[data-prov]').forEach((card) => {
    const prov = card.dataset.prov;
    const saveBtn = card.querySelector('[data-inv-save]');
    if (saveBtn) saveBtn.onclick = async () => {
      try {
        await api('POST', '/api/settlements', {
          period: settleMonth, provider: prov,
          invoice_amount: Number(card.querySelector('[data-inv-amt]').value) || 0,
          note: card.querySelector('[data-inv-note]').value,
          confirmed: card.querySelector('[data-inv-confirm]').checked,
        });
        toast('저장되었습니다.'); navigate();
      } catch (err) { toast(err.message, true); }
    };
    const delBtn = card.querySelector('[data-inv-del]');
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm('입력한 청구액을 삭제할까요?')) return;
      await api('DELETE', `/api/settlements/${delBtn.dataset.invDel}`); toast('삭제되었습니다.'); navigate();
    };
  });
});

/* ---------------- 부팅 ---------------- */
(async function boot() {
  try {
    const data = await api('GET', '/api/me');
    state.me = data.user;
    state.access = data.access;
    state.settings = data.settings;
    state.classSession = data.classSession || null;
    state.mustAgree = !!data.mustAgree;
    Live.start(); // 게스트일 때만 내부에서 동작
  } catch { state.me = null; }
  try {
    const { registerProjectUI } = await import('/project-ui.js');
    registerProjectUI({
      route, api, shell, state, esc, icon, toast, openModal, navigate, level, isStaff, $app,
    });
  } catch (err) {
    console.error('AI 프로젝트 화면을 불러오지 못했습니다.', err);
  }
  if (!location.hash) location.hash = state.me ? (isStaff() ? '#/' : '#/decks') : '#/login';
  navigate();
  // 시간제 접근 상태 주기 갱신 (5분)
  setInterval(refreshMe, 5 * 60 * 1000);
})();
