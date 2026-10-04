'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {perfumerCard}=require('../lib/plaza-perfumer-card');
const {aiInput,validatedOutput,exampleOutput,cycle,slidesInput,studentCard}=require('../lib/plaza-program');
const card=perfumerCard({synthetic:true});
test('실제 키트 미확정이면 AI 활동을 열지 않고 가짜 재료는 명시적 시험 설정에만 있다',()=>{
  const real=perfumerCard();assert.equal(real.materials.length,0);assert.equal(real.materials_status,'키트 목록 확인 대기');
  assert.throws(()=>aiInput(real,'ideas',{customer_id:'gentle',material_ids:['test-a']}),e=>e.code==='kit_pending');
});
test('AI 외부 입력에는 허용된 카드와 선택형 값만 남고 개인 입력은 실리지 않는다',()=>{
  const input=aiInput(card,'ideas',{customer_id:'gentle',material_ids:['test-a'],student_uuid:'secret-id',name:'private-name',store_name:'private-store',reflection:'private-reflection',photo:'private-photo'});
  const raw=JSON.stringify(input);assert.ok(!raw.includes('private-'));assert.ok(!raw.includes('secret-id'));
  assert.deepEqual(input.combinations.map(c=>c.id),['test-a-only']);
  assert.throws(()=>aiInput(card,'ideas',{customer_id:'gentle',material_ids:['unapproved']}));
});
test('AI 출력은 승인 조합과 문구 ID만 허용하며 자유 효능 문장은 화면에 전달하지 않는다',()=>{
  const input=aiInput(card,'ideas',{customer_id:'gentle',material_ids:['test-a']});
  const output=validatedOutput(input,{ideas:[{combination_id:'test-a-only',introduction_id:'listen',claim:'치료 효과'}, {combination_id:'test-a-only',introduction_id:'describe'}]});
  assert.equal(JSON.stringify(output).includes('치료'),false);
  assert.throws(()=>validatedOutput(input,{ideas:[{combination_id:'test-b-only',introduction_id:'listen'},{combination_id:'test-a-only',introduction_id:'guide'}]}));
  assert.throws(()=>validatedOutput(input,{ideas:[{combination_id:'test-a-only',introduction_id:'invented'},{combination_id:'test-a-only',introduction_id:'guide'}]}));
  assert.deepEqual(validatedOutput(input,exampleOutput(input)),exampleOutput(input));
});
test('1~31명 방문은 한 순환이며 홀수·1명·0명에서 자기 가게 방문을 만들지 않는다',()=>{
  assert.deepEqual(cycle([]),[]);
  for(let n=1;n<=31;n++) {
    const ids=Array.from({length:n},(_,i)=>String(i)),visits=cycle(ids,()=>0);
    assert.equal(visits.length,n);assert.equal(new Set(visits.map(v=>v.visitor_id)).size,n);
    if(n===1){assert.equal(visits[0].host_id,null);assert.equal(visits[0].substitute,true);continue;}
    assert.equal(new Set(visits.map(v=>v.host_id)).size,n);
    const seen=new Set();let current=ids[0];for(let i=0;i<n;i++){assert.ok(!seen.has(current));seen.add(current);current=visits.find(v=>v.visitor_id===current).host_id;}assert.equal(current,ids[0]);
    assert.ok(visits.every(v=>v.host_id!==v.visitor_id&&!v.substitute));
  }
});
test('학생 카드에서 교안과 임의 속성을 제외하고 교안은 실행 코드·외부 미디어를 받지 않는다',()=>{
  const student=studentCard({...card,teacher_slides:['PRIVATE'],api_key:'secret'});assert.equal(JSON.stringify(student).includes('PRIVATE'),false);assert.equal(student.api_key,undefined);
  const material=slidesInput({title:'시험',script:'danger',slides:[{title:'확인',lines:['활동 안내'],notes:'발표자 설명',minutes:1,html:'<script>danger</script>',url:'https://private.example'}]});
  assert.equal(material.slides[0].html,undefined);assert.equal(material.slides[0].url,undefined);assert.throws(()=>slidesInput({title:'빈 교안',slides:[]}));
});
