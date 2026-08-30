'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'landing.css'), 'utf8');

test('랜딩은 핵심 접근성 랜드마크와 모션 감축 설정을 갖는다', () => {
  assert.match(html, /<main id="main">/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-label="주요 메뉴"/);
  assert.match(html, /id="gallery-toggle"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('랜딩의 id는 중복되지 않는다', () => {
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('랜딩에서 참조하는 로컬 정적 자산이 존재한다', () => {
  const references = Array.from(html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g), (match) => match[1]);
  const assets = references.filter((reference) => reference !== '/' && !reference.startsWith('/class'));
  const missing = assets.filter((reference) => !fs.existsSync(path.join(publicDir, reference)));
  assert.deepEqual(missing, []);
});

test('랜딩 수업 사진은 고해상도 로컬 자산 7장을 중복 없이 사용한다', () => {
  const photos = Array.from(html.matchAll(/src="(\/brand\/landing\/[^"]+\.jpg)"/g), (match) => match[1]);
  assert.equal(photos.length, 7);
  assert.equal(new Set(photos).size, photos.length);
  assert.doesNotMatch(html, /data:image\/jpeg;base64/);

  photos.forEach((photo) => {
    assert.ok(fs.statSync(path.join(publicDir, photo)).size > 100_000, `${photo}는 고해상도 사진이어야 합니다`);
  });
});

test('메인 문구에는 강제 줄바꿈이나 준비 중 판매 CTA가 없다', () => {
  assert.doesNotMatch(html, /<br\s*\/?\s*>/i);
  assert.doesNotMatch(html, /가격 준비 중|국비지원 과정|수강 신청/);
  assert.doesNotMatch(html, /【이메일】/);
});

test('랜딩 전용 한글 폰트는 S-Core Dream을 사용한다', () => {
  assert.match(css, /font-family: 'S-Core Dream'/);
  assert.match(css, /S-CoreDream-4Regular\.woff/);
  assert.match(css, /word-break: keep-all/);
});
