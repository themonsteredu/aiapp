'use strict';

const VERIFIED_ON = '2026-07-25';

const DEFAULT_CONFIG = Object.freeze({
  serviceName: '광주픽',
  tagline: '관심사·시간·예산에 맞는 광주의 문화·진로 자원을 추천합니다.',
  audience: '광주에서 문화·체험·진로활동을 찾는 중학생',
  primaryColor: '#6D3AF2',
  accentColor: '#FFCC4D',
  startButton: '내게 맞는 광주 찾기',
  retryButton: '조건 바꿔 다시 추천',
  resultTitle: '나에게 맞는 광주 자원 3곳',
  slogan: '광주를 고르는 새로운 기준',
  aiEnabled: false,
  questions: {
    interest: '어떤 분야가 가장 궁금한가요?',
    time: '활동에 쓸 수 있는 시간은 어느 정도인가요?',
    budget: '예산 범위를 골라 주세요.',
    activity: '어떤 방식의 활동을 원하나요?',
    companion: '누구와 함께하나요?',
  },
  options: {
    interest: ['미술', '공연', 'AI·미디어', '역사', '공예', '로컬문화', '진로체험'],
    time: ['1시간', '반나절', '하루'],
    budget: ['무료', '1만원 이하', '상관없음'],
    activity: ['관람형', '체험형', '탐방형', '진로탐색형'],
    companion: ['혼자', '친구', '가족', '학급'],
  },
  weights: {
    interest: 40,
    time: 20,
    budget: 15,
    activity: 15,
    companion: 10,
  },
});

const GWANGJU_RESOURCES = Object.freeze([
  {
    id: 'acc',
    name: '국립아시아문화전당',
    summary: '전시·공연·창제작 콘텐츠를 한곳에서 살펴보는 복합문화예술기관입니다.',
    tags: ['문화예술', '공연', '미디어', '전시'],
    interests: ['미술', '공연', 'AI·미디어', '진로체험'],
    audiences: ['중학생', '가족', '학급'],
    times: ['1시간', '반나절', '하루'],
    costs: ['무료', '1만원 이하', '상관없음'],
    activities: ['관람형', '체험형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['전시기획자', '공연기획자', '문화콘텐츠 기획자'],
    highlights: ['전시와 공연을 함께 비교', '아시아 문화 콘텐츠 탐색', '문화예술 직무 관찰'],
    sourceUrl: 'https://www.acc.go.kr/',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '운영시간·요금·예약 여부는 프로그램별로 달라 공식 누리집 재확인 필요',
  },
  {
    id: 'gmap',
    name: '광주미디어아트플랫폼 G.MAP',
    summary: '디지털 기술과 예술이 만나는 미디어아트 전시·교육 공간입니다.',
    tags: ['미디어아트', 'AI', '디지털', '전시'],
    interests: ['미술', 'AI·미디어', '진로체험'],
    audiences: ['중학생', '친구', '학급'],
    times: ['1시간', '반나절'],
    costs: ['무료', '상관없음'],
    activities: ['관람형', '체험형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['미디어아티스트', '인터랙션 디자이너', '디지털 전시기획자'],
    highlights: ['AI·VR·미디어아트 탐색', '디지털 창작 사례 관찰', '예술과 기술 융합 직무 연결'],
    sourceUrl: 'https://gmap.gwangju.go.kr/',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '전시와 교육 일정은 공식 누리집 재확인 필요',
  },
  {
    id: 'biennale',
    name: '광주비엔날레',
    summary: '동시대 미술의 다양한 질문과 국제적인 작품을 만나는 문화예술 자원입니다.',
    tags: ['동시대미술', '국제교류', '전시'],
    interests: ['미술', '로컬문화', '진로체험'],
    audiences: ['중학생', '친구', '학급'],
    times: ['반나절', '하루'],
    costs: ['1만원 이하', '상관없음'],
    activities: ['관람형', '탐방형', '진로탐색형'],
    companions: ['친구', '가족', '학급'],
    careers: ['큐레이터', '작가', '국제문화교류 기획자'],
    highlights: ['동시대 미술 주제 탐구', '국제 전시 운영 살펴보기', '작품 해석과 토론'],
    sourceUrl: 'https://www.gwangjubiennale.org/gb/index.do',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '행사 기간·전시 장소·요금은 회차별 공식 안내 재확인 필요',
  },
  {
    id: 'art-museum',
    name: '광주시립미술관',
    summary: '광주와 국내외 미술 작품을 전시하고 교육 프로그램을 운영하는 공립미술관입니다.',
    tags: ['미술', '전시', '교육'],
    interests: ['미술', '진로체험'],
    audiences: ['중학생', '가족', '학급'],
    times: ['1시간', '반나절'],
    costs: ['무료', '1만원 이하', '상관없음'],
    activities: ['관람형', '체험형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['큐레이터', '미술교육사', '보존과학자'],
    highlights: ['전시 구성 살펴보기', '작품 감상과 해석', '미술관 직무 탐색'],
    sourceUrl: 'https://artmuse.gwangju.go.kr/',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '휴관일과 교육 프로그램 예약 여부 재확인 필요',
  },
  {
    id: 'yangnim',
    name: '양림동 역사문화마을',
    summary: '근현대 건축과 생활문화, 예술 공간을 걸으며 광주의 시간층을 탐색하는 마을입니다.',
    tags: ['근현대사', '건축', '마을', '로컬문화'],
    interests: ['역사', '로컬문화', '진로체험'],
    audiences: ['중학생', '친구', '가족', '학급'],
    times: ['1시간', '반나절', '하루'],
    costs: ['무료', '1만원 이하', '상관없음'],
    activities: ['탐방형', '관람형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['문화관광해설사', '도시재생 기획자', '건축가'],
    highlights: ['근현대 건축 답사', '마을 문화 기록', '도시와 역사 연결'],
    sourceUrl: 'https://tour.gwangju.go.kr/home/tour/info/history.cs?act=view&infoId=323',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '개별 시설 운영 여부와 해설 예약은 방문 전 재확인 필요',
  },
  {
    id: 'penguin-village',
    name: '펭귄마을·공예거리',
    summary: '생활 물건을 활용한 정크아트와 지역 공방을 함께 만나는 골목형 문화공간입니다.',
    tags: ['공예', '정크아트', '마을', '로컬문화'],
    interests: ['공예', '미술', '로컬문화', '진로체험'],
    audiences: ['중학생', '친구', '가족'],
    times: ['1시간', '반나절'],
    costs: ['무료', '1만원 이하', '상관없음'],
    activities: ['탐방형', '체험형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['공예작가', '마을기획자', '업사이클 디자이너'],
    highlights: ['정크아트 골목 탐방', '지역 공방 관찰', '업사이클 아이디어 찾기'],
    sourceUrl: 'https://tour.gwangju.go.kr/home/tour/info/history.cs?act=view&infoId=323',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '공방별 체험·요금·예약은 서로 달라 현장 또는 공식 관광자료 재확인 필요',
  },
  {
    id: 'national-museum',
    name: '국립광주박물관',
    summary: '광주·전남의 역사와 문화유산을 전시·연구하는 국립박물관입니다.',
    tags: ['역사', '문화유산', '박물관'],
    interests: ['역사', '공예', '진로체험'],
    audiences: ['중학생', '가족', '학급'],
    times: ['1시간', '반나절'],
    costs: ['무료', '상관없음'],
    activities: ['관람형', '체험형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['학예연구사', '고고학자', '문화재 보존과학자'],
    highlights: ['지역 문화유산 관찰', '전시 자료 비교', '박물관 전문직 탐색'],
    sourceUrl: 'https://gwangju.museum.go.kr/kor/index.do',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '교육·체험 프로그램의 일정과 예약 여부 재확인 필요',
  },
  {
    id: 'archives-518',
    name: '5·18민주화운동기록관',
    summary: '5·18민주화운동 관련 기록물을 통해 민주·인권·평화의 의미를 배우는 기록문화 공간입니다.',
    tags: ['역사', '민주인권', '기록'],
    interests: ['역사', '로컬문화', '진로체험'],
    audiences: ['중학생', '학급', '가족'],
    times: ['1시간', '반나절'],
    costs: ['무료', '상관없음'],
    activities: ['관람형', '탐방형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['기록연구사', '역사연구자', '인권교육가'],
    highlights: ['기록물로 역사 읽기', '사료의 출처 비교', '기록·인권 직무 탐색'],
    sourceUrl: 'https://www.518archives.go.kr/',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '단체 관람과 해설 운영은 공식 누리집 재확인 필요',
  },
  {
    id: 'traditional-culture',
    name: '광주전통문화관',
    summary: '남도의 전통공연·무형문화재·공예와 음식문화를 배우고 체험하는 공간입니다.',
    tags: ['전통문화', '공연', '공예', '체험'],
    interests: ['공연', '공예', '로컬문화', '진로체험'],
    audiences: ['중학생', '가족', '학급'],
    times: ['1시간', '반나절'],
    costs: ['무료', '1만원 이하', '상관없음'],
    activities: ['관람형', '체험형', '진로탐색형'],
    companions: ['친구', '가족', '학급'],
    careers: ['전통공연 기획자', '공예가', '무형유산 교육사'],
    highlights: ['전통공연 관람', '공예·음식 체험 탐색', '무형유산 전승 직무 연결'],
    sourceUrl: 'https://tour.gwangju.go.kr/home/tour/info/culture.cs?act=view&infoId=85',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '상설공연·체험 일정과 참가비는 프로그램별 재확인 필요',
  },
  {
    id: 'market-1913',
    name: '1913송정역시장',
    summary: '오래된 시장의 시간성과 새로운 상점·브랜드가 공존하는 로컬문화 공간입니다.',
    tags: ['전통시장', '브랜딩', '로컬문화', '먹거리'],
    interests: ['로컬문화', '진로체험'],
    audiences: ['중학생', '친구', '가족'],
    times: ['1시간', '반나절'],
    costs: ['1만원 이하', '상관없음'],
    activities: ['탐방형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['로컬브랜드 기획자', '상권기획자', '콘텐츠 마케터'],
    highlights: ['시장 변화 관찰', '상점 브랜딩 비교', '지역 상권 직무 탐색'],
    sourceUrl: 'https://tour.gwangju.go.kr/home/tour/info/shopping/002.cs?act=view&infoId=83',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '상점별 영업시간·휴무·가격은 방문 전 재확인 필요',
  },
  {
    id: 'samdi',
    name: '광주청소년삶디자인센터',
    summary: '청소년이 일과 삶, 진로를 스스로 탐색하고 프로젝트를 경험하는 공간입니다.',
    tags: ['청소년', '진로', '메이커', '프로젝트'],
    interests: ['진로체험', 'AI·미디어', '공예'],
    audiences: ['중학생', '친구', '학급'],
    times: ['1시간', '반나절', '하루'],
    costs: ['무료', '1만원 이하', '상관없음'],
    activities: ['체험형', '진로탐색형'],
    companions: ['혼자', '친구', '학급'],
    careers: ['진로교육 기획자', '메이커교육가', '청소년활동가'],
    highlights: ['진로 프로젝트 탐색', '도구와 제작 활동 경험', '삶과 일의 연결 질문'],
    sourceUrl: '',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 필요',
    operatorMemo: '공식 HTTPS 누리집 연결 상태와 현재 프로그램을 운영자가 다시 확인한 뒤 공개',
  },
  {
    id: 'gwangju-tour',
    name: '광주관광 공식자료',
    summary: '광주광역시가 제공하는 관광명소·행사·가이드북 정보를 비교하는 공식 자료 모음입니다.',
    tags: ['관광정보', '자료조사', '로컬문화'],
    interests: ['로컬문화', '역사', '공연', '미술', '공예'],
    audiences: ['중학생', '친구', '가족', '학급'],
    times: ['1시간', '반나절', '하루'],
    costs: ['무료', '상관없음'],
    activities: ['탐방형', '진로탐색형'],
    companions: ['혼자', '친구', '가족', '학급'],
    careers: ['관광콘텐츠 기획자', '문화관광해설사', '공공데이터 기획자'],
    highlights: ['공식 자료 출처 확인', '여러 자원 비교', '방문 계획의 근거 만들기'],
    sourceUrl: 'https://tour.gwangju.go.kr/home/main.cs',
    checkedAt: VERIFIED_ON,
    verificationStatus: '검증 완료',
    operatorMemo: '개별 장소의 최신 운영정보는 각 기관 공식자료로 다시 확인',
  },
]);

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function normalizeConfig(config = {}) {
  const base = cloneDefaultConfig();
  const merged = {
    ...base,
    ...config,
    questions: { ...base.questions, ...(config.questions || {}) },
    options: { ...base.options, ...(config.options || {}) },
    weights: { ...base.weights, ...(config.weights || {}) },
  };
  merged.resourceIds = Array.isArray(config.resourceIds) && config.resourceIds.length
    ? [...new Set(config.resourceIds.map(String))]
    : GWANGJU_RESOURCES.filter((r) => r.verificationStatus === '검증 완료').map((r) => r.id);
  merged.primaryColor = /^#[0-9a-f]{6}$/i.test(merged.primaryColor) ? merged.primaryColor : base.primaryColor;
  merged.accentColor = /^#[0-9a-f]{6}$/i.test(merged.accentColor) ? merged.accentColor : base.accentColor;
  return merged;
}

function list(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

function scoreResource(resource, input, weights) {
  const matches = {
    interest: list(resource.interests).includes(input.interest),
    time: list(resource.times).includes(input.time),
    budget: input.budget === '상관없음' || list(resource.costs).includes(input.budget),
    activity: list(resource.activities).includes(input.activity),
    companion: list(resource.companions).includes(input.companion),
  };
  const score = Object.entries(matches).reduce(
    (sum, [key, yes]) => sum + (yes ? Number(weights[key] || 0) : 0),
    0
  );
  return { score, matches };
}

function buildReason(resource, input, matches) {
  const parts = [];
  if (matches.interest) parts.push(`${input.interest} 관심사`);
  if (matches.activity) parts.push(`${input.activity} 활동`);
  if (matches.time) parts.push(`${input.time} 일정`);
  if (matches.budget && input.budget !== '상관없음') parts.push(`${input.budget} 예산`);
  if (matches.companion) parts.push(`${input.companion} 동행`);
  const fit = parts.length ? parts.slice(0, 3).join('·') : '선택한 조건';
  return `${fit}과 잘 맞습니다. ${resource.highlights[0]}을 중심으로 살펴보면 좋아요.`;
}

function recommend({ input = {}, config = {}, resources = GWANGJU_RESOURCES, limit = 3 } = {}) {
  const normalized = normalizeConfig(config);
  const allowed = new Set(normalized.resourceIds);
  const candidates = resources
    .filter((r) => allowed.has(r.id) && r.verificationStatus === '검증 완료')
    .map((resource) => {
      const scored = scoreResource(resource, input, normalized.weights);
      return {
        ...resource,
        score: scored.score,
        matchedConditions: Object.keys(scored.matches).filter((key) => scored.matches[key]),
        reason: buildReason(resource, input, scored.matches),
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ko'));
  return candidates.slice(0, Math.max(1, Math.min(6, Number(limit) || 3)));
}

function detectPersonalInfo(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  const findings = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) findings.push('이메일 주소');
  if (/(?:01[016789]|0\d{1,2})[-.\s]?\d{3,4}[-.\s]?\d{4}/.test(text)) findings.push('전화번호');
  if (/\b\d{6}[-\s]?[1-4]\d{6}\b/.test(text)) findings.push('주민등록번호 형태');
  if (/(?:초등학교|중학교|고등학교|학교명)\s*[:：]?\s*[가-힣A-Za-z0-9]+/i.test(text)) findings.push('학교명');
  if (/(?:위도|경도|GPS|현재\s*위치|집\s*주소|거주지)\s*[:：]/i.test(text)) findings.push('위치정보');
  return [...new Set(findings)];
}

module.exports = {
  VERIFIED_ON,
  DEFAULT_CONFIG,
  GWANGJU_RESOURCES,
  cloneDefaultConfig,
  normalizeConfig,
  scoreResource,
  recommend,
  detectPersonalInfo,
};
