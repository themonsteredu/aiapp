'use strict';
// Vercel 서버리스 함수 진입점 — 모든 /api/* 요청이 여기로 라우팅된다 (vercel.json rewrites 참고)
// 광장 온라인 시험 모드는 lib/api(=lib/db)를 읽기 전에 판정한다. 설정이 어긋나면 DB에 연결하지 않는다.
const plazaOnline = require('../lib/plaza-online');
const plazaOnlineBlocked = plazaOnline.entryBlocked();
const { handleApi } = plazaOnlineBlocked ? { handleApi: plazaOnline.blockedApi(plazaOnlineBlocked) } : require('../lib/api');

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://internal');
    const pathname = decodeURIComponent(url.pathname);
    // Vercel은 JSON 본문을 req.body로 파싱해 준다. 문자열로 오는 경우도 대비.
    let body = req.body ?? null;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    await handleApi(req, res, pathname, body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.' }));
  }
};
