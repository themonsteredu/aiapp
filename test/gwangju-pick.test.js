'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GWANGJU_RESOURCES,
  normalizeConfig,
  recommend,
  detectPersonalInfo,
} = require('../lib/gwangju-pick');
const { configFromSessionFour } = require('../lib/project-api');

const INPUTS = {
  art: {
    interest: '미술',
    time: '1시간',
    budget: '무료',
    activity: '관람형',
    companion: '친구',
  },
  history: {
    interest: '역사',
    time: '하루',
    budget: '상관없음',
    activity: '탐방형',
    companion: '학급',
  },
};

test('추천 결과는 검증된 등록 자원 3건으로 제한된다', () => {
  const registered = new Set(GWANGJU_RESOURCES.map((resource) => resource.id));
  const results = recommend({ input: INPUTS.art });
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.equal(registered.has(result.id), true);
    assert.equal(result.verificationStatus, '검증 완료');
    assert.ok(result.sourceUrl);
    assert.ok(result.checkedAt);
  }
});

test('입력 조건이 달라지면 추천 순위가 달라진다', () => {
  const art = recommend({ input: INPUTS.art }).map((resource) => resource.id);
  const history = recommend({ input: INPUTS.history }).map((resource) => resource.id);
  assert.notDeepEqual(art, history);
});

test('팀이 선택한 데이터셋 밖의 자원은 추천하지 않는다', () => {
  const config = normalizeConfig({ resourceIds: ['acc', 'gmap', 'art-museum'] });
  const results = recommend({ input: INPUTS.history, config });
  assert.deepEqual(
    new Set(results.map((resource) => resource.id)),
    new Set(['acc', 'gmap', 'art-museum'])
  );
});

test('4차시 기획 결과를 안전한 AppConfig로 변환한다', () => {
  const config = configFromSessionFour({
    appPlan: {
      serviceName: '우리팀 광주픽',
      tagline: '우리 반을 위한 추천',
      primaryColor: '#123456',
      selectedResources: ['acc', 'gmap', 'yangnim'],
      weights: { interest: 50, time: 20, budget: 10, activity: 10, companion: 10 },
    },
  });
  assert.equal(config.serviceName, '우리팀 광주픽');
  assert.equal(config.primaryColor, '#123456');
  assert.deepEqual(config.resourceIds, ['acc', 'gmap', 'yangnim']);
  assert.equal(config.weights.interest, 50);
});

test('잘못된 색상은 기본 색상으로 복구한다', () => {
  const config = normalizeConfig({ primaryColor: 'javascript:alert(1)' });
  assert.equal(config.primaryColor, '#6D3AF2');
});

test('이메일·전화번호·주민등록번호 형태를 저장 전에 감지한다', () => {
  const findings = detectPersonalInfo({
    email: 'student@example.com',
    phone: '010-1234-5678',
    id: '010101-3123456',
  });
  assert.ok(findings.includes('이메일 주소'));
  assert.ok(findings.includes('전화번호'));
  assert.ok(findings.includes('주민등록번호 형태'));
});
