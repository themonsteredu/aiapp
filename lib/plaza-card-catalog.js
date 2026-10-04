'use strict';
const {fail,text} = require('./plaza-program');
const {perfumerCard} = require('./plaza-perfumer-card');
const ID=/^[a-z][a-z0-9-]{0,59}$/;
function object(value,keys) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))fail(400,'프로그램 카드의 필수 항목과 허용 항목을 확인해 주세요.');
  return value;
}
function plain(value,max) {
  const s=text(value,max);
  if(/[<>\u0000-\u001f\u007f]/u.test(s)||/(?:https?:|data:|javascript:|www\.)/i.test(s))fail(400,'카드에는 짧은 일반 문장만 넣어 주세요. 주소·HTML·스크립트는 넣을 수 없습니다.');
  return s;
}
function id(value){if(typeof value!=='string'||!ID.test(value))fail(400,'카드 선택지 번호를 확인해 주세요.');return value;}
function array(value,min,max){if(!Array.isArray(value)||value.length<min||value.length>max)fail(400,'카드 선택지 개수를 확인해 주세요.');return value;}
function choices(value,field,max,min=1) {
  const rows=array(value,min,10).map(v=>{object(v,['id',field]);return {id:id(v.id),[field]:plain(v[field],max)};});
  unique(rows.map(v=>v.id));return rows;
}
function unique(ids){if(new Set(ids).size!==ids.length)fail(400,'같은 카드 안의 선택지 번호는 서로 달라야 합니다.');}
// A card supplies content only: state transitions, questions, permissions and AI rules remain server code.
// Canonical projection makes reordered JSON a harmless retry, while rejecting hidden/private fields.
function validateCard(input) {
  object(input,['program_key','version','example_version','display','materials_status','problem','customers','materials','combinations','introductions','requests','reply_options','reactions','names','reflection_options']);
  if(!Number.isSafeInteger(input.version)||input.version<1||input.version>10000)fail(400,'양의 정수 카드 버전이 필요합니다.');
  if(!['test-approved','키트 목록 확인 대기'].includes(input.materials_status))fail(400,'현재는 시험용 또는 키트 확인 대기 카드만 등록합니다.');
  object(input.display,['profession','product','material_prompt','material_label','reply_help']);
  const display=Object.fromEntries(Object.entries({profession:40,product:60,material_prompt:160,material_label:20,reply_help:160}).map(([k,max])=>[k,plain(input.display[k],max)]));
  const ready=input.materials_status==='test-approved';
  const materials=array(input.materials,ready?1:0,10).map(v=>{object(v,['id','title','description']);return {id:id(v.id),title:plain(v.title,40),description:plain(v.description,140)};});
  unique(materials.map(v=>v.id));
  const combinations=array(input.combinations,ready?1:0,10).map(v=>{
    object(v,['id','title','material_ids']);const ids=array(v.material_ids,1,10).map(id);unique(ids);
    if(ids.some(key=>!materials.some(m=>m.id===key)))fail(400,'조합에는 등록된 재료만 넣어 주세요.');
    return {id:id(v.id),title:plain(v.title,50),material_ids:[...ids].sort()};
  });unique(combinations.map(v=>v.id));
  if(!ready&&(materials.length||combinations.length))fail(400,'키트 확인 대기 카드에는 임의의 재료·조합을 넣을 수 없습니다.');
  object(input.names,['artwork','store']);
  return {
    program_key:id(input.program_key),version:input.version,example_version:id(input.example_version),display,
    materials_status:input.materials_status,problem:plain(input.problem,300),customers:choices(input.customers,'title',80),materials,combinations,
    introductions:choices(input.introductions,'text',160,2),requests:choices(input.requests,'text',160),reply_options:choices(input.reply_options,'text',240),reactions:choices(input.reactions,'text',100),
    names:{artwork:choices(input.names.artwork,'text',40),store:choices(input.names.store,'text',40)},
    reflection_options:array(input.reflection_options,3,3).map(v=>array(v,1,6).map(s=>plain(s,90))),
  };
}
function templates({synthetic=false}={}) {
  const perfumer={...perfumerCard({synthetic}),version:3,display:{profession:'조향사',product:'석고 방향제',material_prompt:'책상의 시향지를 맡고, 사용할 재료를 골라 주세요.',material_label:'시향지',reply_help:'향의 효능을 약속하지 말고, 키트에서 확인한 안내로 설명해 주세요.'}};
  const craft={
    program_key:'craft-design',version:1,example_version:'craft-copy-1',
    display:{profession:'공예디자이너',product:'나만의 작은 공예품',material_prompt:'강사와 재료의 모양·촉감을 확인하고, 사용할 재료를 골라 주세요.',material_label:'재료',reply_help:'안전과 사용 방법은 키트 안내를 확인하고, 모르는 점은 강사에게 물어봐 주세요.'},
    materials_status:synthetic?'test-approved':'키트 목록 확인 대기',
    problem:'같은 물건도 사람마다 쓰는 방법과 좋아하는 모양이 다르다. 서로 다른 손님이 편하게 이해하고 고를 수 있는 공예품은 어떻게 만들까?',
    customers:[{id:'first',title:'공예품을 처음 골라 보는 손님'},{id:'shape',title:'모양과 촉감을 말로 듣고 싶은 손님'},{id:'gift',title:'선물할 사람의 취향을 모르는 손님'}],
    materials:synthetic?[{id:'craft-a',title:'시험 공예 재료 A',description:'공통 흐름 검증을 위한 가짜 재료입니다. 실제 키트가 아닙니다.'},{id:'craft-b',title:'시험 공예 재료 B',description:'공통 흐름 검증을 위한 가짜 재료입니다. 실제 키트가 아닙니다.'}]:[],
    combinations:synthetic?[{id:'craft-a-only',title:'시험 구성 A',material_ids:['craft-a']},{id:'craft-b-only',title:'시험 구성 B',material_ids:['craft-b']}]:[],
    introductions:[{id:'ask',text:'손님이 어떤 곳에서 쓰고 싶은지 먼저 물어볼게요.'},{id:'describe',text:'모양과 촉감을 말로 설명하고 손님의 생각을 들어볼게요.'},{id:'guide',text:'키트에서 확인한 사용 안내를 손님과 함께 읽어 볼게요.'}],
    requests:[{id:'first',text:'처음 고르는 손님이 이해하기 쉽게 소개해 줄 수 있나요?'},{id:'gift',text:'선물 받는 사람이 좋아할지 모르겠어요. 무엇부터 물어볼까요?'}],
    reply_options:[{id:'ask',text:'어떤 점이 궁금한지 먼저 듣고 설명해 볼게요.'},{id:'guide',text:'키트 안내를 함께 확인하고 모르는 점은 강사에게 물어볼게요.'}],
    reactions:[{id:'understood',text:'설명이 이해됐어요'},{id:'curious',text:'이 부분이 궁금해요'},{id:'helpful',text:'손님을 배려한 설명이 도움이 됐어요'}],
    names:{artwork:[{id:'piece',text:'작은 모양'},{id:'gift',text:'마음 조각'}],store:[{id:'workshop',text:'모양 공방'},{id:'room',text:'생각 가게'}]},
    reflection_options:[['손님의 쓰임을 생각한 일','작품의 모양을 바꿔 본 일','다른 가게에 답한 일'],['예시를 다시 읽어 봤어요','강사에게 물어봤어요','설명을 바꿔 봤어요'],['재료를 고르는 방법','손님의 사용 경험을 알아보는 방법','공예디자이너가 작품을 만드는 과정']],
  };
  return [perfumer,craft].map(validateCard);
}
module.exports={validateCard,templates};
