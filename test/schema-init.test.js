'use strict';
// 콜드스타트 초기화가 "이미 최신이면 건너뛴다"를 지키는지 검증한다.
// DB 없이 돌 수 있도록 db.js 를 통째로 부르지 않고, 판정 함수만 같은 규칙으로 재현해 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const dbSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf-8');

test('SCHEMA_VERSION 상수가 존재하고 숫자다', () => {
  const m = /const SCHEMA_VERSION = (\d+);/.exec(dbSrc);
  assert.ok(m, 'SCHEMA_VERSION 을 찾을 수 없다');
  assert.ok(Number(m[1]) >= 1);
});

test('schema_meta 테이블을 만들고 버전을 기록한다', () => {
  assert.match(dbSrc, /CREATE TABLE IF NOT EXISTS schema_meta/);
  assert.match(dbSrc, /INSERT INTO schema_meta \(key, value\) VALUES \('version'/);
});

test('init 은 최신 버전이면 곧바로 반환한다 (DDL 건너뛰기)', () => {
  assert.match(dbSrc, /if \(await schemaIsCurrent\(\(sql\) => pool\.query\(sql\)\)\) return;/);
});

test('동시 초기화를 막는 자문 잠금을 잡고 반드시 푼다', () => {
  assert.match(dbSrc, /pg_advisory_lock\(\$1\)/);
  assert.match(dbSrc, /pg_advisory_unlock\(\$1\)/);
  // 잠금 해제는 finally 에 있어야 한다 — 실패해도 잠금이 남으면 이후 인스턴스가 전부 멈춘다
  const finallyBlock = /finally \{[\s\S]*?pg_advisory_unlock[\s\S]*?\}/.exec(dbSrc);
  assert.ok(finallyBlock, 'pg_advisory_unlock 이 finally 블록 안에 없다');
});

test('잠금을 잡은 뒤에는 풀이 아니라 잡은 커넥션으로 질의한다', () => {
  // 풀 크기가 1인 Vercel 에서 잠금을 쥔 채 pool.query 를 부르면 스스로를 기다리다 멈춘다
  const initBody = /async function init\(\) \{[\s\S]*?\n\}/.exec(dbSrc)[0];
  const afterLock = initBody.slice(initBody.indexOf('pg_advisory_lock'));
  assert.ok(!/pool\.query/.test(afterLock), '잠금 획득 이후에 pool.query 가 남아 있다');
});

test('설정 캐시는 저장 시 무효화된다', () => {
  const setBody = /async function setSetting\([\s\S]*?\n\}/.exec(dbSrc)[0];
  assert.match(setBody, /invalidateSettings\(\)/);
});

test('세션·자산 조회 인덱스가 정의돼 있다', () => {
  assert.match(dbSrc, /idx_sessions_user ON sessions\(user_id\)/);
  assert.match(dbSrc, /idx_sessions_expires ON sessions\(expires_at\)/);
  assert.match(dbSrc, /idx_assets_deck ON assets\(deck_id\)/);
});
