'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

// Only browser-reencoded, bounded JPEGs. Remove APP/COM metadata again on the server.
// Scan the marker structure, including entropy stuffing and restart markers.
function jpegInput(data) {
  if (typeof data !== 'string' || data.length > 900023 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) fail('사진은 작은 JPG 파일로 올려 주세요.');
  const raw = Buffer.from(data.slice(23), 'base64');
  if (raw.length < 32 || raw.length > 675000 || raw.readUInt16BE(0) !== 0xffd8) fail('JPG 사진 형식을 확인해 주세요.');
  const pieces = [raw.subarray(0, 2)];
  let offset = 2, width, height, scanned = false, ended = false;
  while (offset < raw.length) {
    const start = offset;
    if (raw[offset++] !== 0xff) fail('사진 데이터가 손상되었습니다.');
    while (raw[offset] === 0xff) offset++;
    const marker = raw[offset++];
    if (marker === 0xd9) { pieces.push(Buffer.from([0xff, 0xd9])); ended = true; break; }
    if (marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > raw.length) fail('사진 데이터가 손상되었습니다.');
    const len = raw.readUInt16BE(offset);
    if (len < 2 || offset + len > raw.length) fail('사진 데이터가 손상되었습니다.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (len < 8) fail('사진 크기를 확인할 수 없습니다.');
      height = raw.readUInt16BE(offset + 3); width = raw.readUInt16BE(offset + 5);
      if (!width || !height || width > 1280 || height > 1280) fail('사진의 긴 변은 1280픽셀 이하여야 합니다.');
    }
    const metadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    const end = offset + len;
    if (!metadata) pieces.push(raw.subarray(start, end));
    offset = end;
    if (marker === 0xda) {
      scanned = true;
      const scanStart = offset;
      while (offset < raw.length - 1) {
        if (raw[offset] !== 0xff) { offset++; continue; }
        const next = raw[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
      pieces.push(raw.subarray(scanStart, offset));
    }
  }
  if (!ended || !scanned || !width || !height) fail('완전한 JPG 사진을 올려 주세요.');
  const buffer = Buffer.concat(pieces);
  return { buffer, digest: digest(buffer), bytes: buffer.length, width, height };
}

function localTestStorage(config) {
  async function verify() {
    const root = await fs.realpath(config.storageRoot);
    if (root !== config.storageRoot) throw new Error('시험 사진 폴더의 실제 경로가 다릅니다.');
    const marker = JSON.parse(await fs.readFile(path.join(root, '.plaza-test-store.json'), 'utf8'));
    if (marker.testId !== config.testId || marker.purpose !== 'stage1-local-test') throw new Error('시험 사진 저장소 표식이 일치하지 않습니다.');
  }
  function filename(key) {
    if (!/^[0-9a-f-]{36}\.jpg$/.test(key)) throw new Error('Invalid plaza object key');
    return path.join(config.storageRoot, key);
  }
  return {
    verify,
    async put(key, image) {
      await verify();
      // Immutable object names: concurrent identical retries are safe; changed bytes conflict.
      const file = filename(key);
      const tmp = path.join(config.storageRoot, `${key}.${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(tmp, image.buffer, { mode: 0o600, flag: 'wx' });
        try { await fs.link(tmp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (digest(await fs.readFile(file)) !== image.digest) throw Object.assign(new Error('같은 촬영 번호에 다른 사진이 있습니다.'), { status: 409 });
      } finally { await fs.rm(tmp, { force: true }); }
    },
    async read(key) { await verify(); return fs.readFile(filename(key)); },
  };
}
module.exports = { jpegInput, localTestStorage };
