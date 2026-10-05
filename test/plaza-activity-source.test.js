'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {templates,validateCard}=require('../lib/plaza-card-catalog');
const {activitySource,sourceInput,requireSource,sourceRecord}=require('../lib/plaza-activity-source');
const {aiInput,studentCard}=require('../lib/plaza-program');
const card=()=>templates({synthetic:true})[0];
const body=()=>({adapter_id:'ai-smell',adapter_version:1,mode:'app',inspiration_id:'calm',confirm:true});

test('connected perfumer version and generic craft retain the same common flow without rewriting old cards',()=>{
  assert.equal(card().version,4);assert.equal(activitySource(card()).url,'https://ai-smell.vercel.app/');
  const old={...card(),version:3};delete old.source_activity;
  assert.equal(activitySource(validateCard(old)),null);
  assert.equal(activitySource(templates()[1]),null);
  assert.deepEqual(studentCard(card()).source_activity,{id:'ai-smell',version:1});
});
test('cards cannot add arbitrary external origins, adapter versions or cross-program adapters',()=>{
  for(const source of [{id:'ai-smell',version:1,url:'https://evil.invalid'},{id:'arbitrary',version:1},{id:'ai-smell',version:2},null]){
    assert.throws(()=>validateCard({...card(),source_activity:source}),e=>e.status===400);
  }
  assert.throws(()=>validateCard({...templates()[1],source_activity:{id:'ai-smell',version:1}}),e=>e.status===400);
});
test('source confirmation rejects private free text and client-supplied identity or provenance',()=>{
  for(const extra of [{student_id:'someone'},{url:'https://evil.invalid'},{reading:'개인 질문'},{photo:'data:image/jpeg'},{source:'imported'},{confirmed_at:'yesterday'}]){
    assert.throws(()=>sourceInput(card(),{...body(),...extra}),e=>e.status===400);
  }
  for(const patch of [{confirm:false},{adapter_id:'other'},{adapter_version:2},{mode:'auto-imported'},{inspiration_id:'not-a-choice'}]){
    assert.throws(()=>sourceInput(card(),{...body(),...patch}),e=>e.status===400);
  }
});
test('source provenance distinguishes student confirmation from a lesson without the app',()=>{
  const source=sourceInput(card(),body());assert.equal(source.source,'student-confirmed');
  assert.throws(()=>requireSource(card(),{}),e=>e.code==='source_activity_required');
  assert.match(sourceRecord(card(),{source_activity:source}),/학생이 확인/);
  assert.match(sourceRecord(card(),{source_activity:{...source,mode:'without-app'}}),/기존 앱 없이 강사 안내/);
  assert.equal(sourceRecord(templates()[1],{}),'');
});
test('existing bounded AI request excludes source app choices and private results',()=>{
  const c=card(),selection={customer_id:c.customers[0].id,material_ids:c.materials.map(m=>m.id)};
  const clean=aiInput(c,'ideas',selection);
  assert.deepEqual(aiInput(c,'ideas',{...selection,source_activity:body(),reading:'private'}),clean);
  assert.doesNotMatch(JSON.stringify(clean),/ai-smell|inspiration|private|student-confirmed/);
});
