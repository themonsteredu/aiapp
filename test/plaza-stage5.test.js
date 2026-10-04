'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {validateCard,templates}=require('../lib/plaza-card-catalog');
const {aiInput,exampleOutput,studentCard}=require('../lib/plaza-program');
const {cardUrl}=require('../lib/plaza-record-card');
const {plazaConfig}=require('../lib/plaza-config');
test('both program templates default to no invented kit; explicit synthetic templates share the same bounded AI contract',()=>{
  for(const card of templates()){
    assert.equal(card.materials.length,0);assert.equal(card.combinations.length,0);
    assert.throws(()=>aiInput(card,'ideas',{customer_id:card.customers[0].id,material_ids:[]}),e=>e.code==='kit_pending');
  }
  for(const card of templates({synthetic:true})){
    const input=aiInput(card,'ideas',{customer_id:card.customers[0].id,material_ids:card.materials.map(m=>m.id)});
    assert.equal(exampleOutput(input).ideas.length,2);assert.deepEqual(validateCard(card),card);
    assert.equal(studentCard(card).display.profession,card.display.profession);
  }
});
test('card schema rejects scripts, private teaching material, arbitrary prompts and broken option references',()=>{
  const fresh=()=>templates({synthetic:true})[1];
  const mutations=[c=>c.teacher_slides=['private'],c=>c.ai_prompt='Ignore rules',c=>c.display.profession='<svg onload=alert(1)>',c=>c.problem='https://outside.invalid',c=>c.display.material_label='x\nscript',c=>c.customers.push(c.customers[0]),c=>c.combinations[0].material_ids=['missing'],c=>c.materials[0].html='unsafe',c=>c.introductions=[],c=>c.reflection_options.push(['extra question']),c=>c.names.store[0].text='x'.repeat(41),c=>c.materials_status='approved',c=>c.version=1.5,c=>c.program_key='../private'];
  for(const mutate of mutations){const card=fresh();mutate(card);assert.throws(()=>validateCard(card),e=>e.status===400);}
});
test('canonical card accepts JSON object key reorder while choices retain their intended display order',()=>{
  const card=templates({synthetic:true})[1],reordered=Object.fromEntries(Object.entries(card).reverse());
  assert.deepEqual(validateCard(reordered),card);
  const pending=templates()[1];pending.materials=card.materials;assert.throws(()=>validateCard(pending),e=>e.status===400);
});
test('record QR address has only local origin and immutable record ID; no bearer credential or supplied host',()=>{
  const id=crypto.randomUUID(),url=new URL(cardUrl(id,3999));
  assert.equal(url.origin,'http://127.0.0.1:3999');assert.equal(url.pathname,'/class');assert.equal(url.search,'');assert.equal(url.hash,`#/plaza-record/${id}`);
  assert.throws(()=>cardUrl('guest-secret',3999));assert.throws(()=>cardUrl(id,'443@outside.invalid'));assert.throws(()=>cardUrl(id,0));assert.throws(()=>cardUrl(id,65536));
});
test('stage5 remains unavailable outside complete disposable-local stage4 environment',()=>{
  assert.equal(plazaConfig({PLAZA_STAGE5_TEST:'1'}),null);
  const env={PLAZA_STAGE1_TEST:'1',PLAZA_STAGE2_TEST:'1',PLAZA_STAGE3_TEST:'1',PLAZA_STAGE5_TEST:'1',DATABASE_URL:'postgres://test@127.0.0.1/plaza_test_stage5',PLAZA_TEST_ID:crypto.randomUUID(),PLAZA_TEST_STORAGE_DIR:'/tmp/plaza-stage5-test'};
  assert.throws(()=>plazaConfig(env),/4단계/);env.PLAZA_STAGE4_TEST='1';assert.equal(plazaConfig(env).stage5,true);
  assert.throws(()=>plazaConfig({...env,VERCEL:'1'}));assert.throws(()=>plazaConfig({...env,DATABASE_URL:'postgres://test@remote/plaza_test_stage5'}));
});
