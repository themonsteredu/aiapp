'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { plazaConfig } = require('../lib/plaza-config');
const { jpegInput, localTestStorage } = require('../lib/plaza-storage');
const { draftInput } = require('../lib/plaza');
const id=crypto.randomUUID();
const env={PLAZA_STAGE1_TEST:'1',DATABASE_URL:'postgresql://test@127.0.0.1:55432/plaza_test_disposable',PLAZA_TEST_ID:id,PLAZA_TEST_STORAGE_DIR:'/tmp/plaza-private-test'};

test('광장은 기본 비활성이고 시험 표식·로컬 DB·별도 사진 경로가 모두 필요하다',()=>{
  assert.equal(plazaConfig({}),null);assert.equal(plazaConfig(env).testId,id);
  for(const patch of [{VERCEL:'1'},{DATABASE_URL:'postgresql://test@production.example/plaza_test_disposable'},
    {DATABASE_URL:'postgresql://test@127.0.0.1/postgres'}, {PLAZA_TEST_ID:''},
    {PLAZA_TEST_STORAGE_DIR:path.resolve(__dirname,'../public/photos')}]) assert.throws(()=>plazaConfig({...env,...patch}));
});
test('초안은 카드의 손님과 길이·버전을 검증하고 학생 번호·진로기록 원문을 받지 않는다',()=>{
  const body={attempt_id:id,version:0,customer_id:'gentle',plan:'내 구상',store_name:'작은 가게',artwork_name:'첫 작품',student_uuid:crypto.randomUUID(),reflection:'비공개 기록'};
  const input=draftInput(body,{customers:[{id:'gentle'}]});assert.equal(input.content.student_uuid,undefined);assert.equal(input.content.reflection,undefined);
  assert.throws(()=>draftInput({...body,version:-1},{customers:[{id:'gentle'}]}));
  assert.throws(()=>draftInput({...body,customer_id:'invented'},{customers:[{id:'gentle'}]}));
  assert.throws(()=>draftInput({...body,plan:'a'.repeat(501)},{customers:[{id:'gentle'}]}));
});
test('사진은 실제 JPEG 구조와 크기를 검사하고 EXIF·추가 바이트를 저장하지 않는다',async()=>{
  const data=await fs.readFile(path.join(__dirname,'fixtures/plaza-photo.txt'),'utf8');const photo=jpegInput(data);
  assert.equal(photo.width,32);assert.equal(photo.height,24);
  const raw=Buffer.from(data.slice(23),'base64');
  const metadata=Buffer.concat([Buffer.from([0xff,0xe1,0,12]),Buffer.from('GPS-private')]);
  // Correct segment length includes its two-byte length field.
  metadata.writeUInt16BE(metadata.length-2,2);
  const injected=Buffer.concat([raw.subarray(0,2),metadata,raw.subarray(2),Buffer.from('private trailing bytes')]);
  const cleaned=jpegInput('data:image/jpeg;base64,'+injected.toString('base64'));
  assert.equal(cleaned.digest,photo.digest);assert.equal(cleaned.buffer.includes(Buffer.from('GPS-private')),false);
  for(const bad of ['data:image/jpeg;base64,'+Buffer.from('<svg>not a photo</svg>').toString('base64'),
    data.slice(0,-24),'data:image/png;base64,AAAA', 'data:image/jpeg;base64,'+'A'.repeat(900004)]) assert.throws(()=>jpegInput(bad));
});
test('비공개 시험 사진 파일은 재시도에도 하나이고 다른 내용·경로·표식을 거절한다',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'plaza-store-'));
  try{
    await fs.writeFile(path.join(root,'.plaza-test-store.json'),JSON.stringify({testId:id,purpose:'stage1-local-test'}));
    const storage=localTestStorage({testId:id,storageRoot:root});const data=await fs.readFile(path.join(__dirname,'fixtures/plaza-photo.txt'),'utf8');
    const photo=jpegInput(data),key=crypto.randomUUID()+'.jpg';
    await Promise.all([storage.put(key,photo),storage.put(key,photo)]);
    assert.equal((await storage.read(key)).equals(photo.buffer),true);
    assert.equal((await fs.readdir(root)).filter(f=>f.endsWith('.jpg')).length,1);
    await assert.rejects(storage.put(key,{...photo,digest:'different'}),e=>e.status===409);
    await assert.rejects(storage.read('../public.jpg'));
    await assert.rejects(localTestStorage({testId:crypto.randomUUID(),storageRoot:root}).read(key));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('5분 인증 갱신은 같은 참여자의 광장 입력 화면을 보존하고 권한 변화 때 다시 라우팅한다',async()=>{
  const vm=require('node:vm');const app=await fs.readFile(path.join(__dirname,'../public/app.js'),'utf8');
  const source=app.slice(app.indexOf('async function refreshMe()'),app.indexOf('/* ---------------- 주간',app.indexOf('async function refreshMe()')));
  for(const change of ['same','user','blocked','agreement','password']){
    let navigation=0,revalidation=0;
    const user={id:7,role:'student',mustChangePassword:change==='password'};
    const state={me:{id:7}};
    const ctx={state,location:{hash:'#/plaza/room'},plazaScreen:{hash:'#/plaza/room',async revalidate(){revalidation++}},
      async api(){return {user:{...user,id:change==='user'?8:7},access:{allowed:change!=='blocked'},settings:{},mustAgree:change==='agreement'}},navigate(){navigation++}};
    vm.runInNewContext(source,ctx);await ctx.refreshMe();
    assert.equal(revalidation,change==='same'?1:0,change);assert.equal(navigation,change==='same'?0:1,change);
  }
});
