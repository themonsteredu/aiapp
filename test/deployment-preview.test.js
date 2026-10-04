'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const root = path.join(__dirname, '..');

function preview(entry) {
  let dispatch;
  const context = {
    __dirname: root, URL, Buffer, module: { exports: {} },
    process: { env: { MOALAB_DEPLOY_ONLY: '1', DATABASE_URL: 'postgres://inherited.invalid/production', PORT: '0' } },
    console: { log() {}, error(error) { throw error; } },
    require(name) {
      if (name === 'node:http') return { createServer(handler) {
        dispatch = handler;
        return { listen() {} };
      } };
      if (name.endsWith('/lib/deploy-preview')) return require('../lib/deploy-preview');
      if (name.startsWith('.')) throw new Error(`Preview loaded an unexpected application module: ${name}`);
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, entry), 'utf8'), context);
  dispatch ||= context.module.exports;
  return async (url, method = 'GET') => {
    const req = Readable.from(method === 'GET' ? [] : [Buffer.from('{"plan":"test"}')]);
    Object.assign(req, { url, method, headers: { host: 'preview.invalid' } });
    const res = {
      writeHead(status, headers) { this.status = status; this.headers = headers; return this; },
      end(value) { this.body = value?.toString(); },
    };
    await dispatch(req, res);
    return res;
  };
}

for (const entry of ['server.js', 'api/index.js']) {
  test(`${entry}: deploy-only preview never loads the DB API and blocks reads and mutations`, async () => {
    const request = preview(entry);
    for (const [url, method] of [
      ['/api/me', 'GET'], ['/api/login', 'POST'], ['/api/plaza/rooms/example/draft', 'PUT'],
      ['/api/career-log/records', 'POST'], ['/api/assets/1', 'GET'], ['/api/index', 'GET'],
    ]) {
      const res = await request(url, method);
      assert.equal(res.status, 503);
      assert.equal(JSON.parse(res.body).code, 'deployment_preview');
      assert.equal(res.headers['Cache-Control'], 'no-store');
    }
    const status = await request('/api/deployment-status');
    assert.equal(status.status, 200);
    assert.deepEqual(JSON.parse(status.body), { mode: 'deploy-only', database: 'disconnected', plaza: 'inactive' });
  });
}

test('deploy-only preview serves its app shell, notice and existing static assets', async () => {
  const request = preview('server.js');
  for (const url of ['/', '/class', '/class/student', '/app.html', '/plaza-preview.html', '/brand/plaza/plaza-background.webp']) {
    const res = await request(url);
    assert.equal(res.status, 200, url);
    assert.ok(res.body.length, url);
  }
  const page = await request('/plaza-preview.html');
  assert.match(page.body, /온라인 DB 연결 후/);
  assert.doesNotMatch(page.body, /<form|<script/);
});
