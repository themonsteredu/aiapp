'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'landing.css'), 'utf8');
const js = fs.readFileSync(path.join(publicDir, 'landing.js'), 'utf8');

test('랜딩은 핵심 접근성 랜드마크와 모션 감축 설정을 갖는다', () => {
  assert.match(html, /<main id="main">/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-label="주요 메뉴"/);
  assert.match(html, /id="product-slider"/);
  assert.match(html, /id="product-toggle"/);
  assert.match(html, /id="emerald-horizon"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(js, /prefers-reduced-motion: reduce/);
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

test('프로그램 사진 3장과 웹앱 화면 4장을 중복 없이 사용한다', () => {
  const programPhotos = Array.from(html.matchAll(/src="(\/brand\/landing\/program-[^"]+\.jpg)"/g), (match) => match[1]);
  const productScreens = Array.from(html.matchAll(/src="(\/brand\/showcase\/[^"]+\.jpg)"/g), (match) => match[1]);

  assert.equal(programPhotos.length, 3);
  assert.equal(new Set(programPhotos).size, 3);
  assert.equal(productScreens.length, 4);
  assert.equal(new Set(productScreens).size, 4);
  assert.doesNotMatch(html, /\/brand\/landing\/hero-[^"]+\.jpg/);
  assert.doesNotMatch(html, /data:image\/jpeg;base64/);

  programPhotos.forEach((photo) => {
    assert.ok(fs.statSync(path.join(publicDir, photo)).size > 100_000, `${photo}는 고해상도 사진이어야 합니다`);
  });
});

test('웹앱 슬라이더는 한 화면씩 표시하며 접근 가능한 조작 버튼을 제공한다', () => {
  const slides = Array.from(html.matchAll(/<figure\b[^>]*class="[^"]*\bproduct-slide\b[^"]*"[^>]*>/g), (match) => match[0]);

  assert.equal(slides.length, 4);
  assert.equal(slides.filter((slide) => /aria-hidden="false"/.test(slide)).length, 1);
  assert.equal(slides.filter((slide) => /aria-hidden="true"/.test(slide)).length, 3);

  ['product-prev', 'product-next', 'product-toggle'].forEach((id) => {
    const tag = html.match(new RegExp(`<button\\b[^>]*\\bid="${id}"[^>]*>`));
    assert.ok(tag, `${id} 버튼이 있어야 합니다`);
    assert.match(tag[0], /aria-label="/);
  });

  assert.match(html, /id="product-toggle"[^>]*aria-pressed="false"/);
  assert.match(css, /\.product-slider\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.product-track\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.product-slide\s*\{[^}]*flex:\s*0\s+0\s+100%/s);
});

test('웹앱 슬라이더는 자동 전환과 사용자 제어를 지원한다', () => {
  assert.match(js, /getElementById\('product-slider'\)/);
  assert.match(js, /getElementById\('product-track'\)/);
  assert.match(js, /setInterval\s*\(/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /mouseenter/);
  assert.match(js, /focusin/);
  assert.match(js, /pointerdown/);
  assert.match(js, /pointerup/);
  assert.match(js, /setAttribute\('aria-hidden'/);
  assert.match(js, /setAttribute\('aria-pressed'/);
});

test('Emerald Horizon은 장식용 경량 캔버스로 동작한다', () => {
  const canvas = html.match(/<canvas\b[^>]*id="emerald-horizon"[^>]*>/);

  assert.ok(canvas);
  assert.match(canvas[0], /aria-hidden="true"/);
  assert.match(js, /getContext\('2d'\)/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /Math\.min\(window\.devicePixelRatio/);
});

test('이전 수동 결과물 뷰어와 사진 갤러리는 제거됐다', () => {
  assert.doesNotMatch(html, /\boutput-option\b|id="output-image"|id="output-caption"/);
  assert.doesNotMatch(js, /outputOptions|outputImage|outputCaption/);
  assert.doesNotMatch(html, /\bhero-gallery\b|\bhero-frame\b|id="gallery-toggle"/);
  assert.doesNotMatch(js, /hero-gallery|hero-frame|galleryToggle/);
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
