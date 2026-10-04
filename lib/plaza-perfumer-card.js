'use strict';
// Public program choices, not the private instructor lesson. No real fragrance is assumed.
function perfumerCard({synthetic=false}={}) {
  return {
    program_key:'perfumer-gypsum',version:2,example_version:'perfumer-copy-1',
    materials_status:synthetic?'test-approved':'키트 목록 확인 대기',
    problem:'사람마다 향을 받아들이는 정도가 다르다. 서로 다른 손님을 배려하는 제품과 설명은 어떻게 만들까?',
    customers:[{id:'gentle',title:'강한 향이 부담스러운 손님'},{id:'words',title:'향을 말로 이해하고 싶은 손님'},{id:'gift',title:'선물할 사람의 취향을 모르는 손님'}],
    materials:synthetic?[
      {id:'test-a',title:'시험 재료 A',description:'프로그램 검증용 가짜 재료입니다. 실제 향이 아닙니다.'},
      {id:'test-b',title:'시험 재료 B',description:'프로그램 검증용 가짜 재료입니다. 실제 향이 아닙니다.'}]:[],
    combinations:synthetic?[{id:'test-a-only',title:'시험 조합 A',material_ids:['test-a']},{id:'test-b-only',title:'시험 조합 B',material_ids:['test-b']}]:[],
    introductions:[{id:'listen',text:'어떤 향이 편한지 손님에게 먼저 물어보고 소개할게요.'},{id:'describe',text:'내가 맡은 향의 느낌을 말로 설명하고 손님의 생각도 들어볼게요.'},{id:'guide',text:'제품을 쓰기 전에 키트에서 확인한 사용 안내를 함께 전할게요.'}],
    requests:[{id:'gentle',text:'강한 향이 부담스러운 손님에게 어떻게 소개할까요?'},{id:'gift',text:'선물 받는 사람이 처음 써도 편하려면?'},{id:'place',text:'어디에 두면 좋을까요?'}],
    reply_options:[{id:'ask',text:'어떤 점이 궁금한지 먼저 듣고, 키트에서 확인한 안내를 함께 전할게요.'},{id:'guide',text:'키트의 사용 안내를 같이 확인해 볼까요? 확실하지 않은 점은 강사에게 물어볼게요.'},{id:'choice',text:'손님의 생각을 듣고 설명을 바꿔 볼게요. 사용 방법은 키트 안내를 따라 주세요.'}],
    reactions:[{id:'understood',text:'설명이 이해됐어요'},{id:'curious',text:'이 부분이 궁금해요'},{id:'helpful',text:'손님을 배려한 설명이 도움이 됐어요'}],
    names:{artwork:[{id:'piece',text:'작은 조각'},{id:'story',text:'향의 이야기'},{id:'gift',text:'마음 한 조각'}],store:[{id:'workshop',text:'작은 공방'},{id:'room',text:'이야기 가게'},{id:'scent',text:'향을 듣는 곳'}]},
    reflection_options:[['손님을 생각하며 소개를 바꾼 일','작품을 직접 만든 일','다른 가게의 요청에 답한 일'],['준비된 예시를 다시 읽어 봤어요','강사에게 물어봤어요','다른 방법을 골라 다시 해 봤어요'],['손님의 취향을 알아보는 방법','향을 말로 설명하는 방법','조향사가 새로운 향을 만드는 과정']],
  };
}
module.exports={perfumerCard};
