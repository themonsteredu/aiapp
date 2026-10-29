const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createLive() {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('const Live = {');
  const end = source.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'Live object is present');
  const listeners = new Map();
  let interval = null;
  let requests = 0;
  const document = {
    visibilityState: 'visible',
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  };
  const sandbox = {
    document,
    state: { me: { isGuest: true }, classSession: { id: 'class-1' } },
    location: { hash: '#/decks' },
    window: {},
    toast() {},
    api: async () => { requests++; return { live: null }; },
    setInterval(callback, ms) { assert.equal(ms, 3000); interval = callback; return 1; },
    clearInterval() { interval = null; },
  };
  vm.createContext(sandbox);
  const live = vm.runInContext(source.slice(start, end + 3) + '\nLive;', sandbox);
  return { live, document, listeners, getRequests: () => requests, runInterval: () => interval?.() };
}

async function settle() { await new Promise(resolve => setImmediate(resolve)); }

test('visible class follows the original 3 second refresh; a hidden tab sends no requests', async () => {
  const h = createLive();
  h.live.start();
  await settle();
  assert.equal(h.getRequests(), 1);
  h.runInterval();
  await settle();
  assert.equal(h.getRequests(), 2);
  h.document.visibilityState = 'hidden';
  h.listeners.get('visibilitychange')();
  h.runInterval();
  h.runInterval();
  await settle();
  assert.equal(h.getRequests(), 2);
  h.document.visibilityState = 'visible';
  h.listeners.get('visibilitychange')();
  await settle();
  assert.equal(h.getRequests(), 3, 'returning to the tab refreshes immediately');
  h.live.stop();
  assert.equal(h.listeners.has('visibilitychange'), false);
  h.runInterval();
  await settle();
  assert.equal(h.getRequests(), 3);
});

test('a class started while hidden waits until the student returns', async () => {
  const h = createLive();
  h.document.visibilityState = 'hidden';
  h.live.start();
  await settle();
  assert.equal(h.getRequests(), 0);
  h.document.visibilityState = 'visible';
  h.listeners.get('visibilitychange')();
  await settle();
  assert.equal(h.getRequests(), 1);
});
