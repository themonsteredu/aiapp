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
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const objectPattern = new RegExp(`^(${uuid}\\.jpg)(?:\\.${uuid}\\.tmp)?$`);
  async function ledgerDir() {
    await verify();
    const dir=path.join(config.storageRoot,'.plaza-purge-ledger');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    if(await fs.realpath(dir)!==dir)throw new Error('Invalid deletion ledger');
    return dir;
  }
  function ledgerName(kind,id) {
    if(!['object','room','photo-choice'].includes(kind)||!new RegExp(`^${uuid}(?:\\.jpg)?$`).test(id))throw new Error('Invalid deletion marker');
    return `${kind}-${id}.json`;
  }
  async function marker(kind,id) {
    try{return JSON.parse(await fs.readFile(path.join(await ledgerDir(),ledgerName(kind,id)),'utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async function mark(kind,id,details={}) {
    const file=path.join(await ledgerDir(),ledgerName(kind,id));
    const old=await marker(kind,id);
    const data={...details,kind,id,created_at:old?.created_at||new Date().toISOString(),
      scopes:[...new Set([...(old?.scopes||[]),...(details.scopes||[])])].sort(),
      keys:[...new Set([...(old?.keys||[]),...(details.keys||[])])].sort()};
    const tmp=`${file}.${crypto.randomUUID()}.tmp`;
    // The ledger is outside database snapshots. Keep it when restoring the database.
    const handle=await fs.open(tmp,'wx',0o600);
    try{await handle.writeFile(JSON.stringify(data));await handle.sync();}finally{await handle.close();}
    await fs.rename(tmp,file);
    const directory=await fs.open(path.dirname(file),'r');
    try{await directory.sync();}finally{await directory.close();}
    return data;
  }
  async function checkObject(key) {
    filename(key);
    if(config.stage4&&await marker('object',key))throw Object.assign(new Error('파기 대상 사진입니다.'),{status:410});
  }
  async function inventory() {
    await verify();
    const names=await fs.readdir(config.storageRoot);
    const accepted=names.filter(n=>objectPattern.test(n));
    return {keys:[...new Set(accepted.map(n=>n.match(objectPattern)[1]))].sort(),
      unrecognized_count:names.filter(n=>!n.startsWith('.')&&!objectPattern.test(n)).length};
  }
  async function absent(key) {
    filename(key);await verify();
    const names=await fs.readdir(config.storageRoot);
    return !names.some(n=>objectPattern.test(n)&&n.match(objectPattern)[1]===key);
  }
  return {
    verify,marker,mark,inventory,absent,
    async removeVerified(key) {
      filename(key);await mark('object',key);
      for(const name of await fs.readdir(config.storageRoot)) {
        if(objectPattern.test(name)&&name.match(objectPattern)[1]===key)await fs.unlink(path.join(config.storageRoot,name));
      }
      if(!await absent(key))throw new Error('Object absence not verified');
      return {verified:true};
    },
    async put(key, image) {
      await verify();
      await checkObject(key);
      // Immutable object names: concurrent identical retries are safe; changed bytes conflict.
      const file = filename(key);
      const tmp = path.join(config.storageRoot, `${key}.${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(tmp, image.buffer, { mode: 0o600, flag: 'wx' });
        try { await fs.link(tmp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (digest(await fs.readFile(file)) !== image.digest) throw Object.assign(new Error('같은 촬영 번호에 다른 사진이 있습니다.'), { status: 409 });
        await checkObject(key);
      } finally { await fs.rm(tmp, { force: true }); }
    },
    async read(key) { await verify(); await checkObject(key); return fs.readFile(filename(key)); },
  };
}
module.exports = { jpegInput, localTestStorage };
