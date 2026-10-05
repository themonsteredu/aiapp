'use strict';
const {fail, pick} = require('./plaza-program');

// Reviewed adapters only. Cards cannot supply URLs, scripts, permissions or student identifiers.
// Existing apps remain unmodified; confirmation describes the student's choice, not an imported result.
const SOURCES = [{
  id: 'ai-smell', version: 1, program_keys: ['perfumer-gypsum'],
  title: '마음의 향기 타로', url: 'https://ai-smell.vercel.app/',
  prompt: '향기 활동에서 떠올린 것 중 내 작품에 담고 싶은 분위기를 골라 주세요.',
  help: '카드 해석과 개인적인 질문은 가져오지 않아요. 실제 향과 사용량은 시향지와 강사의 키트 안내로 확인해요.',
  choices: [
    {id: 'bright', text: '밝고 산뜻한 분위기'},
    {id: 'calm', text: '차분하고 은은한 분위기'},
    {id: 'warm', text: '따뜻하고 포근한 분위기'},
    {id: 'fresh', text: '시원하고 맑은 분위기'},
    {id: 'explore', text: '직접 시향하며 찾아보고 싶어요'},
  ],
}];

function activitySource(card) {
  const selected = card.source_activity;
  if (selected === undefined) return null;
  if (!selected || typeof selected !== 'object' || Array.isArray(selected)
      || Object.keys(selected).sort().join(',') !== 'id,version') fail(400, '연결 활동의 종류와 버전을 확인해 주세요.');
  const source = SOURCES.find(s => s.id === selected.id && s.version === selected.version && s.program_keys.includes(card.program_key));
  if (!source) fail(400, '이 프로그램에서 확인한 연결 활동만 사용할 수 있습니다.');
  return structuredClone(source);
}

function sourceInput(card, body) {
  const source = activitySource(card);
  if (!source) fail(409, '이 수업은 광장 기본 구상 화면으로 진행합니다.');
  const keys = ['attempt_id', 'version', 'adapter_id', 'adapter_version', 'mode', 'inspiration_id', 'confirm'];
  if (!body || Object.keys(body).some(k => !keys.includes(k)) || body.confirm !== true
      || body.adapter_id !== source.id || body.adapter_version !== source.version
      || !['app', 'without-app'].includes(body.mode)) fail(400, '가져갈 영감과 활동 방법을 직접 확인해 주세요.');
  const choice = pick(source.choices, body.inspiration_id);
  return {adapter_id: source.id, adapter_version: source.version, mode: body.mode,
    inspiration_id: choice.id, inspiration: choice.text, source: 'student-confirmed'};
}

function requireSource(card, content) {
  const source = activitySource(card);
  if (!source) return;
  const saved = content?.source_activity;
  if (!saved || saved.adapter_id !== source.id || saved.adapter_version !== source.version || saved.source !== 'student-confirmed') {
    fail(409, '기존 활동에서 가져갈 영감을 먼저 확인해 주세요.', 'source_activity_required');
  }
}

function sourceRecord(card, content) {
  requireSource(card, content);
  const source = activitySource(card), saved = content?.source_activity;
  if (!source || !saved) return '';
  return saved.mode === 'app'
    ? `연결 활동: ${source.title}에서 가져갈 영감을 학생이 확인했다. ${saved.inspiration}.\n`
    : `연결 활동 대체: 기존 앱 없이 강사 안내로 작품의 분위기를 골랐다. ${saved.inspiration}.\n`;
}

module.exports = {activitySource, sourceInput, requireSource, sourceRecord,
  activitySources: () => structuredClone(SOURCES)};
