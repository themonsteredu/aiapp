'use strict';

// 업로드형 HTML 웹앱 격리: 서버가 붙이는 CSP sandbox·보조 스크립트, 부모 쪽 iframe 연결을 확인한다.
// 실제 크롬 동작(불투명 출처, 쿠키 미전송, 새로고침 뒤 저장 유지)은 헤드리스 크롬으로 따로 확인했다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  WEBAPP_SANDBOX, WEBAPP_ALLOW, LINK_ALLOW, LINK_ALLOW_MEDIA, STORAGE_MARKER,
  webappHeaders, sandboxShim, shimScript, injectSandboxShim,
} = require('../lib/webapp-sandbox');

const root = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'lib/api.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const SHIM = shimScript(7);
const shimAt = (out) => out.indexOf(SHIM);

test('CSP sandbox 는 예전 iframe 토큰에서 allow-same-origin 을 빼고, 앱이 연 새 창만 샌드박스를 벗게 한다', () => {
  const h = webappHeaders();
  // 새 창이 샌드박스를 이어받으면 외부 사이트(유튜브·커리어넷 등)도 불투명 출처라 저장소·쿠키가 깨진다
  assert.equal(h['Content-Security-Policy'], 'sandbox allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox');
  assert.doesNotMatch(h['Content-Security-Policy'], /allow-same-origin|allow-top-navigation/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(h['Cache-Control'], 'private, no-store');
});

test('보조 스크립트는 doctype 뒤, <head> 첫머리에 들어간다', () => {
  const html = '<!DOCTYPE html>\n<html lang="ko"><head><meta charset="utf-8"><script>app()</script></head><body></body></html>';
  const out = injectSandboxShim(html, 7);
  assert.ok(out.startsWith('<!DOCTYPE html>\n<html lang="ko"><head>' + SHIM + '<meta charset="utf-8">'));
  assert.ok(shimAt(out) < out.indexOf('<script>app()'));
  assert.equal(out.replace(SHIM, ''), html, '원문은 한 글자도 바뀌지 않는다');
});

test('BOM·대문자·앞선 주석이 있어도 doctype 을 맨 앞에 둔다', () => {
  const html = '﻿<!-- made by AI -->\n<!DOCTYPE HTML>\n<HTML LANG="ko">\n<HEAD profile="x">\n<TITLE>t</TITLE></HEAD><BODY></BODY></HTML>';
  const out = injectSandboxShim(html, 7);
  assert.equal(out.charCodeAt(0), 0xfeff, 'BOM 은 맨 앞 그대로');
  assert.ok(out.indexOf('<!DOCTYPE HTML>') < shimAt(out));
  assert.ok(out.indexOf('<HEAD profile="x">') < shimAt(out));
  assert.ok(shimAt(out) < out.indexOf('<TITLE>'));
  assert.equal(out.replace(SHIM, ''), html);
});

test('<head> 가 없으면 <html> 바로 뒤, <html> 도 없으면 문서 맨 앞(doctype 뒤)에 넣는다', () => {
  const noHead = '<!doctype html><html><body><script>app()</script></body></html>';
  assert.ok(injectSandboxShim(noHead, 7).startsWith('<!doctype html><html>' + SHIM + '<body>'));
  const bare = '<h1>안녕</h1><script>app()</script>';
  assert.equal(injectSandboxShim(bare, 7), SHIM + bare);
  const bareDoctype = '<!DOCTYPE html>\n<meta charset="utf-8"><script>app()</script>';
  assert.ok(injectSandboxShim(bareDoctype, 7).startsWith('<!DOCTYPE html>' + SHIM));
  const commentFirst = '<!-- c --><html><head></head></html>';
  assert.equal(injectSandboxShim(commentFirst, 7), '<!-- c --><html><head>' + SHIM + '</head></html>');
});

test('<header> 나 본문 속 "<head>" 문자열을 head 로 착각하지 않는다', () => {
  const header = '<!DOCTYPE html><header>머리</header><script>var s = "<head>";</script>';
  assert.ok(injectSandboxShim(header, 7).startsWith('<!DOCTYPE html>' + SHIM + '<header>'));
  const unterminated = '<!-- 닫히지 않은 주석 <html><head>';
  assert.equal(injectSandboxShim(unterminated, 7), SHIM + unterminated);
  const longSpace = '<!DOCTYPE html>' + ' '.repeat(200_000) + '<body>';
  const started = Date.now();
  injectSandboxShim(longSpace, 7);
  assert.ok(Date.now() - started < 500, '긴 공백에서도 역추적으로 멈추지 않는다');
});

test('보조 스크립트 본문에는 </script 가 섞이지 않고, 앱 id 는 숫자만 들어간다', () => {
  const body = SHIM.slice('<script>'.length, -'</script>'.length);
  assert.doesNotMatch(body, /<\/script/i);
  assert.match(shimScript('7);alert(1'), /\)\(window,0,"moalab-storage:"\);<\/script>$/);
});

// 브라우저 대신 가짜 window 로 보조 스크립트를 돌린다 (주입되는 문자열 그대로 실행)
function runShim({ name = '', app = 7, cookieThrows = true } = {}) {
  const posts = [];
  const document = {};
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get() { if (cookieThrows) throw new Error('SecurityError'); return 'real'; },
    set() { if (cookieThrows) throw new Error('SecurityError'); },
  });
  const w = { name, document, parent: { postMessage: (msg, target) => posts.push({ msg: JSON.parse(JSON.stringify(msg)), target }) } };
  Object.defineProperty(w, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  const code = shimScript(app).slice('<script>'.length, -'</script>'.length);
  vm.runInNewContext(code, { window: w, JSON, Object, String, Number, Proxy });
  return { w, posts };
}

test('저장소: window.name 표식으로 바로 이어받고, 쓸 때마다 name 과 부모에 남긴다', () => {
  const saved = STORAGE_MARKER + JSON.stringify({ app: 7, local: { boots: '2' }, session: { s: '1' } });
  const { w, posts } = runShim({ name: saved });
  assert.equal(w.localStorage.getItem('boots'), '2', '시작하자마자 읽힌다');
  assert.equal(w.sessionStorage.getItem('s'), '1');
  assert.equal(w.localStorage.getItem('없음'), null);
  w.localStorage.setItem('score', 10);
  assert.equal(w.localStorage.getItem('score'), '10', '문자열로 바꿔 저장');
  assert.equal(w.localStorage.length, 2);
  assert.equal(w.localStorage.key(0), 'boots');
  assert.equal(w.localStorage.key(5), null);
  const next = JSON.parse(w.name.slice(STORAGE_MARKER.length));
  assert.deepEqual(next, { app: 7, local: { boots: '2', score: '10' }, session: { s: '1' } });
  assert.deepEqual(posts.at(-1), { msg: { type: 'moalab:storage', app: 7, local: { boots: '2', score: '10' } }, target: '*' });
  // sessionStorage 도 부모에 보낸다 — 화면 갱신으로 iframe 을 다시 만들 때 돌려받는다. 바뀐 쪽만 싣는다
  w.sessionStorage.setItem('t', 'x');
  assert.deepEqual(posts.at(-1).msg, { type: 'moalab:storage', app: 7, session: { s: '1', t: 'x' } });
  assert.deepEqual(JSON.parse(w.name.slice(STORAGE_MARKER.length)).session, { s: '1', t: 'x' });
  w.sessionStorage.clear();
  assert.deepEqual(posts.at(-1).msg, { type: 'moalab:storage', app: 7, session: {} });
  w.localStorage.removeItem('boots');
  w.localStorage.clear();
  assert.equal(w.localStorage.length, 0);
  assert.deepEqual(posts.at(-1).msg.local, {});
});

test('저장소: 속성 접근(localStorage.x)·Object.keys 도 같은 저장소를 쓴다', () => {
  const { w } = runShim();
  w.localStorage.highScore = 30;
  assert.equal(w.localStorage.getItem('highScore'), '30');
  assert.equal(w.localStorage.highScore, '30');
  assert.deepEqual(Object.keys(w.localStorage), ['highScore']);
  assert.ok('highScore' in w.localStorage);
  delete w.localStorage.highScore;
  assert.equal(w.localStorage.getItem('highScore'), null);
  assert.equal(typeof w.localStorage.getItem, 'function', '메서드 이름은 키에 가려지지 않는다');
  w.localStorage.setItem('__proto__', 'x');
  assert.equal(w.localStorage.getItem('__proto__'), 'x');
});

test('다른 웹앱의 window.name·깨진 표식은 이어받지 않는다', () => {
  const other = STORAGE_MARKER + JSON.stringify({ app: 8, local: { secret: '1' } });
  assert.equal(runShim({ name: other }).w.localStorage.getItem('secret'), null);
  assert.equal(runShim({ name: STORAGE_MARKER + '{broken' }).w.localStorage.length, 0);
  assert.equal(runShim({ name: 'plain-name' }).w.localStorage.length, 0);
});

test('document.cookie 는 막혔을 때만 빈 값으로 바꾸고, reportApiUsage 는 부모에 보낸다', () => {
  const { w, posts } = runShim();
  assert.equal(w.document.cookie, '');
  w.document.cookie = 'a=b';
  assert.equal(w.document.cookie, '');
  assert.equal(runShim({ cookieThrows: false }).w.document.cookie, 'real');
  w.reportApiUsage(3);
  assert.deepEqual(posts.at(-1).msg, { type: 'moalab:usage', app: 7, calls: 3 });
});

test('보조 스크립트는 window 가 이상해도 예외를 밖으로 내지 않는다', () => {
  assert.doesNotThrow(() => sandboxShim(null, 7, STORAGE_MARKER));
  assert.doesNotThrow(() => sandboxShim({ get name() { throw new Error('x'); } }, 7, STORAGE_MARKER));
});

test('/api/webapp 은 CSP 헤더와 보조 스크립트로 내보내고, /api/assets 는 HTML 을 내주지 않는다', () => {
  const webapp = apiSource.slice(apiSource.indexOf("route('GET', /^\\/api\\/webapp\\/(\\d+)$/"), apiSource.indexOf('// ---- 슬라이드 배경 라이브러리'));
  assert.match(webapp, /res\.writeHead\(200, webappHeaders\(\)\)/);
  assert.match(webapp, /injectSandboxShim\(Buffer\.from\(a\.data, 'base64'\)\.toString\('utf-8'\), deck\.id\)/);
  const assets = apiSource.slice(apiSource.indexOf("route('GET', /^\\/api\\/assets\\/(\\d+)$/"));
  assert.match(assets.slice(0, 400), /text\\\/html.*notFound\(res\)/s);
  assert.equal(assets.slice(0, assets.indexOf('\n});')).match(/'X-Content-Type-Options': 'nosniff'/g).length, 3, '200·206·416 응답 모두');
});

test('플랫폼 화면의 웹앱 iframe 에 allow-same-origin 이 없다', () => {
  const code = appSource.replace(/^\s*\/\/.*$/gm, ''); // 설명 주석은 빼고 본다
  assert.ok(!code.includes('allow-same-origin'), 'allow-same-origin 이 코드에 남아 있다');
  assert.ok(code.includes(`const WEBAPP_SANDBOX = '${WEBAPP_SANDBOX}';`), '서버 CSP 와 같은 토큰이어야 한다');
  assert.ok(code.includes(`const WEBAPP_STORE_MARKER = '${STORAGE_MARKER}';`), '서버와 같은 표식이어야 한다');
  assert.ok(!/<iframe[^>]*\/api\/webapp/.test(code), 'src 로 직접 열지 않는다');
});

test('iframe allow: 업로드형·외부 링크는 전체화면·클립보드 쓰기·자동재생, 카메라·마이크는 켠 외부 링크만', () => {
  // 크롬에서 확인: clipboard-write 가 없으면 writeText 가 권한 정책으로 거부되고, autoplay 가 없으면 학생이 플랫폼에서
  // 누르고 들어와도 소리 나는 재생이 막힌다. 불투명 출처에서는 camera 를 위임해도 getUserMedia 가 SecurityError 다.
  assert.equal(WEBAPP_ALLOW, 'fullscreen; clipboard-write; autoplay');
  assert.equal(LINK_ALLOW, WEBAPP_ALLOW);
  assert.equal(LINK_ALLOW_MEDIA, 'fullscreen; clipboard-write; autoplay; camera; microphone');
  assert.doesNotMatch(WEBAPP_ALLOW, /camera|microphone/);
  const code = appSource.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(code.includes(`const WEBAPP_ALLOW = '${WEBAPP_ALLOW}';`), 'app.js 와 lib 의 값이 같아야 한다');
  assert.ok(code.includes('const LINK_ALLOW = WEBAPP_ALLOW;'));
  assert.ok(code.includes('const LINK_ALLOW_MEDIA = `${WEBAPP_ALLOW}; camera; microphone`;'));
  // 외부 링크 뷰어: 자료별 mediaAccess 가 켜졌을 때만 camera·microphone
  const viewer = code.slice(code.indexOf("if (data.deck.kind === 'link') {"), code.indexOf('let idx = 0;'));
  assert.match(viewer, /<iframe src="\$\{esc\(gate\.url\)\}" allow="\$\{data\.deck\.mediaAccess \? LINK_ALLOW_MEDIA : LINK_ALLOW\}"/);
  assert.equal((code.match(/camera; microphone/g) || []).length, 1, 'camera 위임은 LINK_ALLOW_MEDIA 한 곳뿐');
  assert.doesNotMatch(code, /allow="[^"$]*(camera|microphone)/, '다른 iframe 에 카메라를 직접 적지 않는다');
});

test('HTML 업로드 화면은 카메라·마이크가 필요한 앱을 외부 배포 웹앱으로 안내하고, 외부 링크 설정에는 라벨 달린 체크박스가 있다', () => {
  assert.match(appSource, /카메라·마이크가 필요한 웹앱은 HTML 업로드로는 동작하지 않습니다\. 웹에 배포한 뒤 '외부 배포 웹앱'으로 등록하고 '카메라·마이크 사용'을 켜 주세요\./);
  assert.match(appSource, /<label for="\$\{id\}"[^>]*>\s*<input type="checkbox" id="\$\{id\}" aria-describedby="\$\{id\}-help"/);
  assert.match(appSource, /media_access: back\.querySelector\('#lm-media'\)\.checked/);
  assert.match(appSource, /media_access: kind === 'link' && back\.querySelector\('#nd-media'\)\.checked/);
});

test('기준 주소(about:srcdoc)는 srcdoc 에만 붙고, 주소로 바로 여는 응답에는 넣지 않는다', () => {
  // 바로 열면 문서 주소가 /api/webapp/<id> 라 "#sec2" 가 제자리 이동이다. 여기에 about:srcdoc 을 두면 오히려 깨진다
  const html = '<!DOCTYPE html><html><head></head><body><a href="#sec2">2장</a></body></html>';
  assert.doesNotMatch(injectSandboxShim(html, 7), /<base\b/i);
  assert.ok(appSource.includes(`const WEBAPP_SRCDOC_BASE = '<base href="about:srcdoc">';`));
});

// 부모 쪽 연결 코드를 app.js 에서 그대로 떼어 가짜 DOM 에서 돌린다. 한 페이지(컨텍스트)에서 여러 번 열 수 있다
function loadBridge({ saved, userId = 42 } = {}) {
  const src = appSource.slice(appSource.indexOf('/* ---------------- 업로드형 HTML 웹앱 연결'), appSource.indexOf('/* ---------------- 뷰어 + 프레젠테이션'));
  const store = new Map(saved ? [[`moalab:webapp:${userId}:7`, saved]] : []);
  const listeners = {};
  const fetches = [];
  const timers = [];
  const ctx = {
    state: { me: { id: userId } },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: { createElement: () => makeFrame() },
    window: {
      addEventListener: (t, fn) => { (listeners[t] ||= new Set()).add(fn); },
      removeEventListener: (t, fn) => { listeners[t]?.delete(fn); if (listeners[t]?.size === 0) delete listeners[t]; },
    },
    fetch: async (url, opts) => {
      fetches.push({ url, opts });
      return { ok: true, text: async () => '<!doctype html><p>app</p>', json: async () => ({}) };
    },
    toast() {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
  };
  let order = [];
  function makeFrame() {
    return {
      attrs: {}, isConnected: true, contentWindow: { id: Symbol('frame') },
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'sandbox') order.push('sandbox'); },
      set name(v) { order.push('name'); this._name = v; }, get name() { return this._name; },
      set srcdoc(v) { order.push('srcdoc'); this._srcdoc = v; }, get srcdoc() { return this._srcdoc; },
    };
  }
  vm.runInNewContext(`${src}\nthis.mount = mountWebappFrame; this.sessions = WEBAPP_SESSIONS;`, ctx);
  const fire = (type, ev = {}) => { for (const fn of [...(listeners[type] || [])]) fn(ev); };
  const mount = async () => {
    order = [];
    let frame;
    const wrap = { prepend: (f) => { frame = f; order.push('prepend'); } };
    const done = ctx.mount(wrap, 7);
    await done;
    const send = (data, source = frame.contentWindow) => fire('message', { source, data });
    const name = () => JSON.parse(frame.name.slice(STORAGE_MARKER.length));
    return { frame, order, send, name };
  };
  return { ctx, store, listeners, fetches, timers, mount, fire, sessions: ctx.sessions };
}

test('부모 연결: 저장해 둔 값을 name 으로 넘기고, 붙이기 전에 정한다', async () => {
  const b = loadBridge({ saved: '{"boots":"3"}' });
  const m = await b.mount();
  // 크롬은 붙인 뒤 바꾼 name 을 넘기지 않는다. sandbox 없이 srcdoc 이 들어가면 플랫폼과 같은 출처가 된다
  assert.deepEqual(m.order, ['name', 'sandbox', 'prepend', 'srcdoc']);
  assert.equal(m.frame.attrs.sandbox, WEBAPP_SANDBOX);
  assert.equal(m.frame.attrs.allow, 'fullscreen; clipboard-write; autoplay');
  assert.deepEqual(m.name(), { app: 7, local: { boots: '3' }, session: {} });
  assert.equal(b.fetches[0].url, '/api/webapp/7');
});

test('부모 연결: srcdoc 끝에 about:srcdoc 기준을 붙여 "#sec2"·"#" 링크가 플랫폼 화면으로 가지 않게 한다', async () => {
  // srcdoc 의 기준 주소는 부모(/class#/view/…)라 "#sec2" 가 /class#sec2 로 iframe 을 바꿔 버린다.
  // 끝에 붙이므로 앱 원문(앞쪽 //cdn 스크립트, 앱 자신의 <base href>)은 그대로 먼저 읽힌다
  const m = await loadBridge().mount();
  assert.equal(m.frame.srcdoc, '<!doctype html><p>app</p><base href="about:srcdoc">');
});

test('부모 연결: 이 iframe 에서 온 메시지만 받고, 1MB 넘는 저장은 버린다', async () => {
  const b = loadBridge();
  const m = await b.mount();
  m.send({ type: 'moalab:storage', app: 7, local: { a: '1' } }, { id: 'other-window' });
  m.send({ type: 'moalab:storage', app: 8, local: { a: '1' } });
  m.send({ type: 'moalab:storage', app: 7, local: ['배열'] });
  assert.equal(b.store.size, 0);
  m.send({ type: 'moalab:storage', app: 7, local: { a: '1' } });
  assert.equal(b.store.get('moalab:webapp:42:7'), '{"a":"1"}');
  m.send({ type: 'moalab:storage', app: 7, local: { big: 'x'.repeat(1_000_001) } });
  assert.equal(b.store.get('moalab:webapp:42:7'), '{"a":"1"}');
});

test('부모 연결: sessionStorage 는 페이지 메모리에만 두고, iframe 을 다시 만들면(5분마다 화면 갱신) name 으로 돌려준다', async () => {
  const b = loadBridge();
  const first = await b.mount();
  first.send({ type: 'moalab:storage', app: 7, session: { step: '3' } });
  assert.equal(b.store.size, 0, 'session 은 부모 localStorage 에 쓰지 않는다');
  assert.equal(b.sessions.get('42:7'), '{"step":"3"}');
  first.send({ type: 'moalab:storage', app: 7, session: { big: 'x'.repeat(1_000_001) } });
  assert.equal(b.sessions.get('42:7'), '{"step":"3"}', '1MB 를 넘으면 직전 것을 둔다');
  first.send({ type: 'moalab:storage', app: 7, session: { step: '4' } }, { id: 'other-window' });
  assert.equal(b.sessions.get('42:7'), '{"step":"3"}', '다른 창의 메시지는 받지 않는다');
  // refreshMe → navigate() 로 화면을 다시 그리면 예전 iframe 은 빠지고 새 iframe 이 생긴다
  first.frame.isConnected = false;
  const second = await b.mount();
  assert.deepEqual(second.name().session, { step: '3' });
  second.send({ type: 'moalab:storage', app: 7, session: { step: '5' }, local: { done: '1' } });
  assert.equal(b.sessions.get('42:7'), '{"step":"5"}');
  assert.equal(b.store.get('moalab:webapp:42:7'), '{"done":"1"}');
  assert.equal(b.listeners.message.size, 1, '빠진 iframe 의 연결은 다음 메시지 때 떨어진다');
});

test('부모 연결: 다른 사용자가 열면 이전 사용자의 sessionStorage 는 지운다', async () => {
  const b = loadBridge();
  const m = await b.mount();
  m.send({ type: 'moalab:storage', app: 7, session: { mine: '42' } });
  b.sessions.set('42:9', '{"other":"deck"}');
  b.fire('hashchange');
  b.ctx.state.me = { id: 43 }; // 같은 탭에서 로그아웃 → 다른 계정
  const next = await b.mount();
  assert.deepEqual(next.name().session, {});
  assert.deepEqual([...b.sessions.keys()], []);
});

test('부모 연결: 사용량은 묶어서 보내고(호출 수 1~10000), 화면을 떠나면 남은 것을 보내고 뗀다', async () => {
  const b = loadBridge();
  const m = await b.mount();
  const send = (calls) => m.send({ type: 'moalab:usage', app: 7, calls });
  send(3); send(-5); send('abc'); send(1e9);
  assert.equal(b.timers.length, 1, '타이머 하나로 묶는다');
  b.fire('hashchange');
  const report = b.fetches.find((f) => f.url === '/api/usage/report');
  assert.deepEqual(JSON.parse(report.opts.body), { deckId: 7, calls: 10000 });
  assert.equal(report.opts.keepalive, true);
  assert.deepEqual(Object.keys(b.listeners), [], 'message·hashchange·pagehide 모두 뗀다');
});

test('부모 연결: pagehide 에서는 사용량만 보내고 계속 듣는다 — 뒤로 가기 캐시(bfcache)에서 돌아와도 저장·보고가 이어진다', async () => {
  const b = loadBridge();
  const m = await b.mount();
  m.send({ type: 'moalab:usage', app: 7, calls: 2 });
  b.fire('pagehide', { persisted: true });
  const reports = () => b.fetches.filter((f) => f.url === '/api/usage/report').map((f) => JSON.parse(f.opts.body).calls);
  assert.deepEqual(reports(), [2], '페이지를 떠날 때 모아 둔 것을 보낸다');
  assert.deepEqual(Object.keys(b.listeners).sort(), ['hashchange', 'message', 'pagehide'], '듣기는 그대로');
  // 복원된 뒤 앱이 계속 쓰고 보고한다
  m.send({ type: 'moalab:storage', app: 7, local: { after: 'restore' } });
  assert.equal(b.store.get('moalab:webapp:42:7'), '{"after":"restore"}');
  m.send({ type: 'moalab:usage', app: 7, calls: 1 });
  b.timers.at(-1)();
  assert.deepEqual(reports(), [2, 1]);
  b.fire('pagehide', { persisted: true });
  assert.deepEqual(reports(), [2, 1], '보낼 것이 없으면 요청하지 않는다');
});

test('부모 연결: iframe 이 빠진 뒤의 pagehide 는 연결을 뗀다', async () => {
  const b = loadBridge();
  const m = await b.mount();
  m.frame.isConnected = false;
  b.fire('pagehide', { persisted: false });
  assert.deepEqual(Object.keys(b.listeners), []);
});

test('보조 스크립트 → 부모 연결: 앱의 sessionStorage 가 iframe 을 다시 만들어도 이어진다', async () => {
  // 실제 주입 문자열(shim)과 실제 부모 코드(app.js)를 이어 붙여 본다
  const b = loadBridge();
  let m = await b.mount();
  for (let boot = 1; boot <= 3; boot++) {
    const { w, posts } = runShim({ name: m.frame.name });
    assert.equal(w.sessionStorage.getItem('boots'), boot === 1 ? null : String(boot - 1));
    w.sessionStorage.setItem('boots', String(boot));
    for (const p of posts) m.send(p.msg);
    m.frame.isConnected = false;
    m = await b.mount();
  }
  assert.deepEqual(m.name().session, { boots: '3' });
});
