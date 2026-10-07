'use strict';
// 수업 입장 코드 부하 시험: 가상 학생 N명이 한 수업에 동시에 들어와 실제 브라우저(public/app.js)와
// 같은 순서·간격으로 요청을 보낸다. 외부 의존성 없음 (Node 22 fetch).
//
//   node scripts/load-test-class.js --base http://127.0.0.1:3999 --students 50 --duration 180 \
//     --join-spread 0 --admin-user superadmin --admin-pass '<비밀번호>' [--new-pass '<바꿀 비밀번호>']
//
// 학생 한 명이 하는 일 (public/app.js 기준)
//   입장 화면: 코드 6자리를 다 치면 GET /api/join-info/<코드>, 이어서 POST /api/join
//   자료 목록(#/decks): GET /api/decks, 3초마다 Live.tick → GET …/live, 라이브가 아니면 __deckRefresh → GET /api/decks
//     (폴링 응답의 itemsVersion 이 목록의 것과 같으면 건너뛴다 — 판을 주지 않는 예전 서버에서는 매번 받는다)
//   웹앱 열기(#/view): GET /api/decks/<id> 후 HTML 은 GET /api/webapp/<id>, 외부 링크는 GET /api/gate-token/<id>
//   라이브(#/live): GET /api/decks/<라이브 덱> 한 번, 이후 3초 폴링만
//   5분마다 refreshMe → GET /api/me
// 강사: 20초에 라이브 시작 → 10초마다 슬라이드 넘김 → 90초에 종료, 60초에 잠가 둔 HTML 웹앱을 연다.
// 수업이 끝나기 전 학생이 401 을 받으면 '튕김'으로 센다. 하나라도 있거나 실패율이 0 이 아니면 exit 1.

const { performance } = require('node:perf_hooks');

function args() {
  const out = { base: 'http://127.0.0.1:3999', students: 50, duration: 180, joinSpread: 0, adminUser: 'superadmin', adminPass: '', newPass: '', htmlKb: 1500 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) {
    const key = a[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = ['students', 'duration', 'joinSpread', 'htmlKb'].includes(key) ? Number(a[i + 1]) : a[i + 1];
  }
  return out;
}
const opt = args();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => ms * (0.85 + Math.random() * 0.3);
const two = (n) => String(n).padStart(2, '0');
// datetime-local 값 (한국시간 벽시계)
const kst = (ms) => { const d = new Date(ms + 9 * 3600e3); return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}T${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };

// ---- 측정 ----
const stats = new Map();
const kicked = [];
const failures = [];
function record(label, status, ms, who) {
  let s = stats.get(label);
  if (!s) stats.set(label, (s = { n: 0, statuses: {}, ms: [] }));
  s.n += 1;
  s.statuses[status] = (s.statuses[status] || 0) + 1;
  s.ms.push(ms);
  if (who !== 'teacher' && (status === 'neterr' || status >= 500)) failures.push({ who, label, status });
}
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };

class Client {
  constructor(who) { this.who = who; this.cookie = ''; }
  async call(method, path, body, label = `${method} ${path.replace(/\d{6}|\d+/g, ':n')}`) {
    const t0 = performance.now();
    let status;
    let data = null;
    try {
      const res = await fetch(opt.base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), 'User-Agent': `load-test ${this.who}` },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      const set = res.headers.get('set-cookie');
      if (set) this.cookie = set.split(';')[0];
      status = res.status;
      const text = await res.text();
      data = (res.headers.get('content-type') || '').includes('json') ? JSON.parse(text || '{}') : { bytes: text.length };
    } catch (e) {
      status = 'neterr';
      data = { error: e.message };
    }
    record(label, status, performance.now() - t0, this.who);
    return { status, data };
  }
}

async function setupTeacher() {
  const t = new Client('teacher');
  let r = await t.call('POST', '/api/login', { username: opt.adminUser, password: opt.adminPass });
  if (r.status !== 200) throw new Error(`teacher login ${r.status} ${JSON.stringify(r.data)}`);
  if (r.data.user?.mustChangePassword) {
    if (!opt.newPass) throw new Error('관리자 비밀번호를 바꿔야 합니다: --new-pass 를 주세요');
    r = await t.call('POST', '/api/password', { current: opt.adminPass, next: opt.newPass });
    if (r.status !== 200) throw new Error(`password change ${r.status} ${JSON.stringify(r.data)}`);
  }
  // 자료 3종: 슬라이드 6장, HTML 웹앱(기본 1.5MB), 외부 링크
  const slides = await t.call('POST', '/api/decks', { title: '부하 시험 슬라이드', kind: 'slides' });
  for (let i = 0; i < 6; i++) await t.call('POST', `/api/decks/${slides.data.id}/slides`, {});
  const filler = 'x'.repeat(1000);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>부하 시험 웹앱</title></head><body><h1>부하 시험 웹앱</h1><script>const notes=[${Array.from({ length: opt.htmlKb }, () => `"${filler}"`).join(',')}];document.body.append(notes.length)</script></body></html>`;
  const app = await t.call('POST', '/api/decks', { title: '부하 시험 웹앱', kind: 'html', html });
  const link = await t.call('POST', '/api/decks', { title: '부하 시험 링크', kind: 'link', external_url: 'https://example.com/' });
  for (const d of [slides, app, link]) if (!d.data?.id) throw new Error(`deck create failed ${JSON.stringify(d.data)}`);
  const now = Date.now();
  const cs = await t.call('POST', '/api/class-sessions', {
    title: `부하 시험 ${opt.students}명`, deck_ids: [slides.data.id, app.data.id, link.data.id],
    duration_minutes: 120, starts_at: kst(now - 60e3), ends_at: kst(now + 2 * 3600e3),
  });
  if (!cs.data?.code) throw new Error(`session create failed ${JSON.stringify(cs.data)}`);
  // HTML 웹앱은 잠가 두었다가 강사가 연다 (학생 화면 자동 갱신 경로)
  const items = await t.call('GET', `/api/class-sessions/${cs.data.id}/items`);
  const appItem = items.data.items.find((i) => i.deck_id === app.data.id);
  await t.call('PATCH', `/api/class-sessions/${cs.data.id}/items/${appItem.id}`, { unlocked: false });
  return { t, sessionId: cs.data.id, code: cs.data.code, slidesId: slides.data.id, appId: app.data.id, linkId: link.data.id, appItemId: appItem.id };
}

async function teacherLoop(ctx, endAt) {
  const { t, sessionId, slidesId, appItemId } = ctx;
  const start = Date.now();
  const at = (s) => sleep(Math.max(0, start + s * 1000 - Date.now()));
  await at(20);
  for (let slide = 0; slide < 7 && Date.now() < endAt; slide++) {
    await t.call('PATCH', `/api/class-sessions/${sessionId}/live`, { deck_id: slidesId, slide: slide % 6 });
    await sleep(10000);
  }
  await t.call('PATCH', `/api/class-sessions/${sessionId}/live`, { deck_id: null });
  await at(100);
  await t.call('PATCH', `/api/class-sessions/${sessionId}/items/${appItemId}`, { unlocked: true });
  while (Date.now() < endAt) { await t.call('GET', '/api/class-sessions'); await sleep(15000); }
}

async function student(i, ctx, endAt) {
  const s = new Client(`student${i}`);
  await sleep(Math.random() * opt.joinSpread * 1000);
  await s.call('GET', `/api/join-info/${ctx.code}`);
  let joined = null;
  for (let attempt = 0; attempt < 3 && !joined; attempt++) {
    const r = await s.call('POST', '/api/join', { code: ctx.code, name: `학생${String(i + 1).padStart(2, '0')}` });
    if (r.status === 200) joined = r.data; else await sleep(2000);
  }
  if (!joined) { kicked.push({ who: s.who, at: 'join' }); return; }
  let view = 'decks';
  let first = (await s.call('GET', '/api/decks')).data || {};
  let decks = first.decks || [];
  let version = first.itemsVersion; // 화면과 같게: 폴링의 판이 같으면 목록을 다시 받지 않는다 (예전 서버는 판이 없어 매번)
  const reload = async () => { const r = await s.call('GET', '/api/decks'); if (r.data?.decks) { decks = r.data.decks; version = r.data.itemsVersion; } return r; };
  let nextMe = Date.now() + 5 * 60e3;
  let openAt = Date.now() + jitter(25000);
  let leaveAt = 0;
  const appOpenable = () => decks.some((d) => d.id === ctx.appId && d.accessibleNow);
  while (Date.now() < endAt) {
    await sleep(jitter(3000));
    const live = await s.call('GET', `/api/class-sessions/${ctx.sessionId}/live`);
    if (live.status === 401) { kicked.push({ who: s.who, at: 'live' }); return; }
    const isLive = !!live.data?.live;
    if (isLive && view !== 'live') {
      view = 'live';
      await s.call('GET', `/api/decks/${live.data.live.deckId}`);
    } else if (!isLive && view === 'live') {
      view = 'decks';
      await reload();
    } else if (view === 'decks') {
      if (!(version && live.data?.itemsVersion === version)) { // __deckRefresh
        const r = await reload();
        if (r.status === 401) { kicked.push({ who: s.who, at: 'decks' }); return; }
      }
      // 자료 열기: 링크 → HTML 웹앱 순서로 한 번씩 (HTML 은 강사가 연 뒤)
      if (Date.now() > openAt) {
        const target = appOpenable() && !s.openedApp ? ctx.appId : !s.openedLink ? ctx.linkId : null;
        if (target) {
          view = 'view';
          await s.call('GET', `/api/decks/${target}`);
          const r2 = target === ctx.appId ? await s.call('GET', `/api/webapp/${target}`) : await s.call('GET', `/api/gate-token/${target}`);
          if (r2.status === 401) { kicked.push({ who: s.who, at: 'open' }); return; }
          if (target === ctx.appId) s.openedApp = true; else s.openedLink = true;
          leaveAt = Date.now() + jitter(40000);
        }
      }
    } else if (view === 'view' && Date.now() > leaveAt) {
      view = 'decks';
      openAt = Date.now() + jitter(10000);
      await reload();
    }
    if (Date.now() > nextMe) { await s.call('GET', '/api/me'); nextMe += 5 * 60e3; }
  }
}

(async () => {
  const ctx = await setupTeacher();
  const t0 = Date.now();
  const endAt = t0 + opt.duration * 1000;
  console.error(`수업 코드 ${ctx.code} · 학생 ${opt.students}명 · ${opt.duration}초 · 입장 분산 ${opt.joinSpread}초`);
  await Promise.all([teacherLoop(ctx, endAt), ...Array.from({ length: opt.students }, (_, i) => student(i, ctx, endAt))]);
  const endpoints = {};
  let total = 0;
  let bad = 0;
  for (const [label, s] of [...stats].sort()) {
    const ok = Object.entries(s.statuses).filter(([k]) => /^2\d\d$/.test(k)).reduce((n, [, v]) => n + v, 0);
    total += s.n;
    bad += s.n - ok;
    endpoints[label] = { n: s.n, statuses: s.statuses, p50: pct(s.ms, 50), p95: pct(s.ms, 95), p99: pct(s.ms, 99), max: pct(s.ms, 100) };
  }
  const summary = {
    students: opt.students, seconds: opt.duration, joinSpread: opt.joinSpread,
    requests: total, rps: Math.round((total / ((Date.now() - t0) / 1000)) * 10) / 10,
    nonOk: bad, studentFailures: failures.length, kickedOut: kicked.length, kicked: kicked.slice(0, 10), endpoints,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(kicked.length || failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
