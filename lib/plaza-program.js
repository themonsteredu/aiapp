'use strict';
const crypto = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (status,message,code) => { throw Object.assign(new Error(message),{status,code}); };
const text = (value,max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400,'입력한 내용과 길이를 확인해 주세요.');
  return value.trim();
};
const pick = (list,id) => { const found = list?.find(item => item.id === id); if (!found) fail(400,'카드의 선택지를 확인해 주세요.'); return found; };
const attempt = body => { if (!UUID.test(body?.attempt_id || '')) fail(400,'저장 번호를 확인해 주세요.'); return body.attempt_id.toLowerCase(); };
const QUESTIONS = ['오늘 한 일 중 가장 기억에 남는 것','막혔을 때 나는 어떻게 했나','이 일에 대해 더 알고 싶은 것'];
// Explicit projection: no private teacher material or arbitrary card properties go to students.
function studentCard(card) {
  const keys = ['program_key','version','display','materials_status','problem','customers','materials','combinations','introductions','requests','reply_options','reactions','names','reflection_options'];
  return Object.fromEntries(keys.filter(k => card[k] !== undefined).map(k => [k,card[k]]));
}
function aiInput(card,kind,selection) {
  if (card.materials_status !== 'test-approved' && card.materials_status !== 'approved') fail(409,'키트 목록 확인 대기 · 강사에게 재료를 확인해 주세요.','kit_pending');
  const customer = pick(card.customers,selection.customer_id);
  if (!Array.isArray(selection.material_ids) || !selection.material_ids.length || selection.material_ids.length > 10 || new Set(selection.material_ids).size !== selection.material_ids.length) fail(400,'확인한 재료를 골라 주세요.');
  const materials = selection.material_ids.map(id => pick(card.materials,id)).sort((a,b) => a.id.localeCompare(b.id));
  const combinations = card.combinations.filter(c => c.material_ids.every(id => materials.some(m => m.id === id)));
  if (!combinations.length || !card.introductions?.length) fail(409,'허용 조합을 강사에게 확인해 주세요.');
  // Provider may ONLY choose IDs in these vetted options. It cannot invent a fragrance, dosage or claim.
  return {kind,customer:{id:customer.id,title:customer.title},materials:materials.map(m => ({id:m.id,title:m.title,description:m.description})),
    combinations:combinations.map(c => ({id:c.id,material_ids:c.material_ids})),
    introductions:card.introductions.map(c => ({id:c.id,text:c.text})),
    ...(kind === 'reply' ? {request:pick(card.requests,selection.request_id),reply_options:card.reply_options.map(r => ({id:r.id,text:r.text}))} : {})};
}
function validatedOutput(input,output) {
  if (input.kind === 'ideas') {
    if (!output || !Array.isArray(output.ideas) || output.ideas.length !== 2) fail(400,'구상 응답 형식이 다릅니다.');
    const ideas = output.ideas.map((idea,i) => ({id:`idea-${i+1}`,combination_id:pick(input.combinations,idea.combination_id).id,introduction_id:pick(input.introductions,idea.introduction_id).id}));
    if (ideas[0].combination_id === ideas[1].combination_id && ideas[0].introduction_id === ideas[1].introduction_id) fail(400,'서로 다른 두 구상이 필요합니다.');
    return {ideas};
  }
  return {reply_id:pick(input.reply_options,output?.reply_id).id};
}
function exampleOutput(input) {
  if (input.kind === 'reply') return {reply_id:input.reply_options[0].id};
  const possibilities = input.combinations.flatMap(c => input.introductions.map(i => ({combination_id:c.id,introduction_id:i.id})));
  if (possibilities.length < 2) fail(409,'서로 다른 구상 예시를 강사에게 확인해 주세요.');
  return validatedOutput(input,{ideas:possibilities.slice(0,2)});
}
function cycle(ids,randomInt = crypto.randomInt) {
  const shuffled = [...ids];
  for (let i=shuffled.length-1;i>0;i--) { const j=randomInt(i+1); [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
  return shuffled.map((id,i) => ({visitor_id:id,host_id:shuffled.length > 1 ? shuffled[(i+1)%shuffled.length] : null,substitute:shuffled.length === 1}));
}
function slidesInput(body) {
  const title=text(body?.title,80);
  if (!Array.isArray(body.slides) || !body.slides.length || body.slides.length > 30) fail(400,'슬라이드는 1~30장으로 준비해 주세요.');
  return {title,slides:body.slides.map(s => {
    if (!Array.isArray(s.lines) || !s.lines.length || s.lines.length>6) fail(400,'슬라이드 문장을 확인해 주세요.');
    return {title:text(s.title,100),lines:s.lines.map(l => text(l,300)),notes:text(s.notes,1800),minutes:Math.min(20,Math.max(0,Number(s.minutes)||0))};
  })};
}
module.exports = {UUID,fail,text,pick,attempt,QUESTIONS,studentCard,aiInput,validatedOutput,exampleOutput,cycle,slidesInput};
