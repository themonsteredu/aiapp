'use strict';
/* ============================================================
 * Supabase Storage 연동 (대용량 동영상 업로드용, 선택 기능)
 * 환경변수 SUPABASE_URL + SUPABASE_SERVICE_KEY 가 있을 때만 활성화.
 * 없으면 자동으로 DB(base64) 저장 방식으로 폴백한다.
 *
 * 흐름:
 *  1) 브라우저가 서버에 서명 업로드 URL 요청 → 서버가 service key로 발급
 *  2) 브라우저가 그 URL로 파일을 Supabase에 직접 PUT (서버·Vercel 우회)
 *  3) 재생 시 서버가 접근 권한 확인 후 짧은 서명 다운로드 URL로 302 리다이렉트
 * ============================================================ */

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'media';
const storageEnabled = !!(SUPABASE_URL && SERVICE_KEY);

// 재생용 서명 URL 유효 시간 (한 차시 수업을 덮도록 넉넉히)
const DOWNLOAD_TTL = 3 * 3600;

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, ...extra };
}

const full = (rel) => `${SUPABASE_URL}/storage/v1${rel.startsWith('/') ? rel : '/' + rel}`;

// 최초 1회: 비공개 버킷 생성 (이미 있으면 무시)
let bucketReady = false;
async function ensureBucket() {
  if (!storageEnabled || bucketReady) return;
  bucketReady = true;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: 209715200 }),
    });
  } catch { /* 이미 존재하거나 네트워크 문제 — 무시 */ }
}

// 서명 업로드 URL 발급 (브라우저가 이 URL로 파일을 PUT)
async function createSignedUpload(path) {
  await ensureBucket();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`업로드 URL 발급 실패: ${await r.text()}`);
  const j = await r.json(); // { url: '/object/upload/sign/...?token=...' }
  return { uploadUrl: full(j.url), path };
}

// 서명 다운로드 URL 발급 (재생용, 단기 유효)
async function createSignedDownload(path, ttl = DOWNLOAD_TTL) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: ttl }),
  });
  if (!r.ok) throw new Error(`재생 URL 발급 실패: ${await r.text()}`);
  const j = await r.json(); // { signedURL: '/object/sign/...?token=...' }
  return full(j.signedURL || j.signedUrl);
}

async function removeObject(path) {
  if (!storageEnabled || !path) return;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
      method: 'DELETE', headers: authHeaders(),
    });
  } catch { /* 무시 */ }
}

module.exports = { storageEnabled, ensureBucket, createSignedUpload, createSignedDownload, removeObject, BUCKET };
