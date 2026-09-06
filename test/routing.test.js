'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function runtime() {
  let dispatch;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), {
    __dirname: root, URL, Buffer, process: { env: { PORT: '0' } },
    console: { log() {}, error(error) { throw error; } },
    require(name) {
      if (name === 'node:http') return { createServer(handler) {
        dispatch = handler;
        return { listen() {} };
      } };
      if (name === './lib/api') return { async handleApi(req, res, pathname, body) {
        calls.push({ url: req.url, pathname, body });
        res.writeHead(401).end(JSON.stringify({ error: 'login required' }));
      } };
      return require(name);
    },
  });
  return { calls, async request(url, method = 'GET', body) {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req, { url, method, headers: { host: 'job.moakit.ai' } });
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
      end(value) { this.body = value?.toString(); },
    };
    await dispatch(req, res);
    return res;
  } };
}

test('Node 배포는 로그인·진로기록 API 주소와 쿼리를 그대로 전달한다', async () => {
  assert.equal(config.framework, 'node');
  assert.equal(config.rewrites.some(rule => rule.source.startsWith('/api')), false);
  const app = runtime();
  for (const url of ['/api/me', '/api/career-log/profile', '/api/career-log/records?class_id=12&offset=25']) {
    const res = await app.request(url);
    assert.equal(res.status, 401);
    const forwarded = app.calls.at(-1);
    assert.equal(forwarded.pathname, url.split('?')[0]);
    assert.equal(forwarded.url, url);
  }
});

test('진로기록 저장 POST는 원래 경로와 JSON 본문을 전달한다', async () => {
  const app = runtime();
  const body = { deck_id: 12, process: '관찰한 내용을 정리했다.' };
  await app.request('/api/career-log/records', 'POST', body);
  assert.equal(app.calls[0].pathname, '/api/career-log/records');
  assert.equal(JSON.stringify(app.calls[0].body), JSON.stringify(body));
});

test('학생 진입 경로는 API가 아닌 앱 셸을 제공한다', async () => {
  const app = runtime();
  for (const url of ['/class', '/class?mode=account', '/class/student']) {
    const res = await app.request(url);
    assert.equal(res.status, 200);
    assert.match(res.body, /career-log\.css/);
  }
  assert.equal(app.calls.length, 0);
});
