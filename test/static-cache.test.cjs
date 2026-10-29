const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

test('only public branding images receive short cache headers', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('function serveStatic(');
  const end = source.indexOf('\n\nfunction readBody', start);
  assert.ok(start >= 0 && end > start);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moalab-static-'));
  try {
    fs.mkdirSync(path.join(dir, 'brand'));
    fs.writeFileSync(path.join(dir, 'brand', 'photo.jpg'), 'image');
    fs.writeFileSync(path.join(dir, 'brand', 'script.js'), 'script');
    fs.writeFileSync(path.join(dir, 'app.js'), 'app');
    fs.writeFileSync(path.join(dir, 'index.html'), 'home');
    const context = vm.createContext({ path, fs, PUBLIC_DIR: dir, MIME: { '.jpg': 'image/jpeg', '.js': 'text/javascript', '.html': 'text/html' } });
    const serveStatic = vm.runInContext(source.slice(start, end) + '\nserveStatic;', context);
    const request = pathname => {
      let status, headers, body;
      serveStatic({ writeHead(s, h) { status = s; headers = h; }, end(b) { body = String(b); } }, pathname);
      return { status, headers, body };
    };
    const image = request('/brand/photo.jpg');
    assert.equal(image.status, 200);
    assert.equal(image.body, 'image');
    assert.equal(image.headers['Cache-Control'], 'public, max-age=60, s-maxage=300');
    assert.equal(request('/brand/script.js').headers['Cache-Control'], 'no-store');
    assert.equal(request('/app.js').headers['Cache-Control'], 'no-store');
    assert.equal(request('/').headers['Cache-Control'], 'no-store');
    assert.equal(request('/missing').headers['Cache-Control'], 'no-store');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
