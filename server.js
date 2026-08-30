'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { handleApi } = require('./lib/api');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  // '/' 는 AI연구소 홈페이지(index.html), '/class' 이하는 플랫폼 SPA(app.html).
  // vercel.json 의 rewrites 와 같은 규칙을 로컬·타 호스팅에서도 그대로 재현한다.
  const isClass = pathname === '/class' || pathname.startsWith('/class/');
  let file = pathname === '/' ? '/index.html' : isClass ? '/app.html' : pathname;
  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    // 알 수 없는 경로는 홈페이지로
    const index = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(index));
  }
  const ext = path.extname(full).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(fs.readFileSync(full));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 40 * 1024 * 1024) { // 동영상 파일 업로드 대비 (Vercel 자체는 4.5MB 제한)
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/api/')) {
      const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req) : null;
      return await handleApi(req, res, pathname, body);
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ error: '서버 오류가 발생했습니다.' }));
  }
});

server.listen(PORT, () => {
  console.log(`진로교육 웹앱 플랫폼 실행 중: http://localhost:${PORT}`);
});
