'use strict';

// 업로드형 HTML 웹앱 격리.
// 강사가 올린 HTML 은 플랫폼과 같은 주소(/api/webapp/<id>)에서 나가므로, 같은 출처로 돌면
// 보는 사람의 로그인으로 진로기록·관리자 API 를 부를 수 있다. 플랫폼 화면은 allow-same-origin 없는
// sandbox iframe 에 srcdoc 으로 넣고(public/app.js mountWebappFrame), 주소로 바로 열 때는 응답 헤더의
// CSP sandbox 가 같은 일을 한다. 불투명 출처에서 막히는 localStorage·sessionStorage·document.cookie 는
// 아래 작은 스크립트가 대신한다. 저장 내용은 window.name 으로 이어받고(앱 안 새로고침에도 남는다),
// 부모가 사용자·웹앱별 키로 보관한다 — localStorage 는 부모의 localStorage 에(1MB 까지), sessionStorage 는 부모 페이지가
// 살아 있는 동안만 메모리에. 플랫폼이 화면을 다시 그려 iframe 을 새로 만들어도(5분마다 refreshMe) 둘 다 이어진다.
// 앱이 여는 새 창(외부 링크·target=_blank)은 allow-popups-to-escape-sandbox 로 샌드박스를 벗는다 — 없으면 유튜브·
// 커리어넷 같은 외부 사이트도 불투명 출처가 되어 저장소·쿠키·로그인이 깨진다. 새 창은 그 주소의 원래 출처로 돌 뿐
// 앱 코드가 들어가지 못하고(/api/webapp 은 CSP sandbox 가 다시 걸린다), 열린 창에서 플랫폼 탭(opener.top)도 못 바꾼다.
// iframe allow 는 WEBAPP_ALLOW(전체화면·클립보드 쓰기·자동재생)만 준다.
// 알려진 제약: 불투명 출처라 카메라·마이크(getUserMedia)는 iframe allow 를 줘도 막힌다. 그런 앱은 웹에 배포해 '외부 배포
// 웹앱'으로 등록하고 자료별 '카메라·마이크 사용'(decks.media_access)을 켠다 — LINK_ALLOW_MEDIA. 크롬은 최상위 문서가 받은
// 카메라 허용을 위임받은 iframe 과 함께 쓰므로 모든 외부 링크에 위임하지 않고 자료마다 켠다. IndexedDB 도 불투명
// 출처에서는 막히고, location 은 about:srcdoc 이다.

const WEBAPP_SANDBOX = 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox';
// iframe allow (public/app.js 와 같은 값). 업로드형 앱 · 외부 링크 기본 · 외부 링크 + 카메라·마이크 사용
const WEBAPP_ALLOW = 'fullscreen; clipboard-write; autoplay';
const LINK_ALLOW = WEBAPP_ALLOW;
const LINK_ALLOW_MEDIA = `${WEBAPP_ALLOW}; camera; microphone`;
const STORAGE_MARKER = 'moalab-storage:';

function webappHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `sandbox ${WEBAPP_SANDBOX}`,
    'X-Content-Type-Options': 'nosniff',
  };
}

// 브라우저에서 앱의 어떤 스크립트보다 먼저 돈다. ES5 로만 쓰고, 어떤 경우에도 예외를 밖으로 내지 않는다.
function sandboxShim(w, app, marker) {
  try {
    var has = Object.prototype.hasOwnProperty;
    var parent = w.parent && w.parent !== w ? w.parent : null;
    var saved = null;
    try {
      if (typeof w.name === 'string' && w.name.indexOf(marker) === 0) saved = JSON.parse(w.name.slice(marker.length));
    } catch (e) {}
    if (!saved || typeof saved !== 'object' || saved.app !== app) saved = {};
    var fill = function (src) {
      var d = Object.create(null);
      if (src && typeof src === 'object') for (var k in src) if (has.call(src, k)) d[k] = String(src[k]);
      return d;
    };
    var data = { local: fill(saved.local), session: fill(saved.session) };
    var make = function (kind) {
      var d = data[kind];
      var save = function () {
        try { w.name = marker + JSON.stringify({ app: app, local: data.local, session: data.session }); } catch (e) {}
        // 바뀐 쪽만 보낸다 — { local } 또는 { session }. 부모는 local 은 저장해 두고, session 은 페이지가 살아 있는 동안만 들고 있다가
        // iframe 을 다시 만들 때(화면 갱신) name 으로 돌려준다.
        if (parent) {
          var msg = { type: 'moalab:storage', app: app };
          msg[kind] = d;
          try { parent.postMessage(msg, '*'); } catch (e) {}
        }
      };
      var s = {
        getItem: function (k) { k = String(k); return k in d ? d[k] : null; },
        setItem: function (k, v) { d[String(k)] = String(v); save(); },
        removeItem: function (k) { k = String(k); if (k in d) { delete d[k]; save(); } },
        clear: function () { var ks = Object.keys(d); for (var i = 0; i < ks.length; i++) delete d[ks[i]]; save(); },
        key: function (i) { var k = Object.keys(d)[Number(i) >>> 0]; return k === undefined ? null : k; }
      };
      Object.defineProperty(s, 'length', { configurable: true, get: function () { return Object.keys(d).length; } });
      if (typeof Proxy !== 'function') return s;
      return new Proxy(s, {
        get: function (t, p) { return p in t || typeof p !== 'string' ? t[p] : (p in d ? d[p] : undefined); },
        set: function (t, p, v) { if (p in t || typeof p !== 'string') t[p] = v; else s.setItem(p, v); return true; },
        has: function (t, p) { return p in t || (typeof p === 'string' && p in d); },
        deleteProperty: function (t, p) { if (typeof p === 'string' && p in d) s.removeItem(p); return true; },
        ownKeys: function () { return Object.keys(d); },
        getOwnPropertyDescriptor: function (t, p) {
          if (typeof p === 'string' && p in d) return { value: d[p], writable: true, enumerable: true, configurable: true };
          return Object.getOwnPropertyDescriptor(t, p);
        }
      });
    };
    var install = function (name, value) {
      try { Object.defineProperty(w, name, { configurable: true, enumerable: true, get: function () { return value; } }); } catch (e) {}
    };
    install('localStorage', make('local'));
    install('sessionStorage', make('session'));
    try { void w.document.cookie; } catch (e) {
      try { Object.defineProperty(w.document, 'cookie', { configurable: true, get: function () { return ''; }, set: function () {} }); } catch (e2) {}
    }
    w.reportApiUsage = function (calls) {
      try { if (parent) parent.postMessage({ type: 'moalab:usage', app: app, calls: Number(calls) || 1 }, '*'); } catch (e) {}
    };
  } catch (e) {}
}

function shimScript(appId) {
  const id = Number.isSafeInteger(appId) ? appId : 0;
  return `<script>(${sandboxShim.toString().replace(/\n\s+/g, '\n')})(window,${id},${JSON.stringify(STORAGE_MARKER)});</script>`;
}

// 문서 앞의 공백·주석(<!-- -->, <? ?>)을 건너뛴다. HTML 공백은 다섯 글자뿐이다.
function skipLead(s, i) {
  for (;;) {
    while (i < s.length && ' \t\n\f\r'.includes(s[i])) i++;
    const [open, end] = s.startsWith('<!--', i) ? ['<!--', '-->'] : s.startsWith('<?', i) ? ['<?', '>'] : [];
    const close = open ? s.indexOf(end, i + open.length) : -1;
    if (close < 0) return i;
    i = close + end.length;
  }
}

function tagEnd(s, i, re) {
  re.lastIndex = i;
  const m = re.exec(s);
  return m ? i + m[0].length : -1;
}

// 보조 스크립트를 앱의 첫 스크립트로 넣는다. <!doctype> 앞에 넣으면 쿼크 모드가 되므로 항상 그 뒤,
// <head> 가 바로 이어지면 그 안 첫머리, 없으면 <html> 바로 뒤(파서가 head 를 만들어 넣는다).
function injectSandboxShim(html, appId) {
  const s = String(html);
  let at = skipLead(s, s.charCodeAt(0) === 0xfeff ? 1 : 0);
  const doctype = tagEnd(s, at, /<!doctype[^>]*>/iy);
  if (doctype >= 0) at = doctype;
  const htmlTag = tagEnd(s, skipLead(s, at), /<html(?=[\s/>])[^>]*>/iy);
  if (htmlTag >= 0) at = htmlTag;
  const headTag = tagEnd(s, skipLead(s, at), /<head(?=[\s/>])[^>]*>/iy);
  if (headTag >= 0) at = headTag;
  return s.slice(0, at) + shimScript(appId) + s.slice(at);
}

module.exports = {
  WEBAPP_SANDBOX, WEBAPP_ALLOW, LINK_ALLOW, LINK_ALLOW_MEDIA, STORAGE_MARKER,
  webappHeaders, sandboxShim, shimScript, injectSandboxShim,
};
