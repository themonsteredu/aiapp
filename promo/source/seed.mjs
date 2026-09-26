// 녹화용 더미 데이터 (실제 개인정보 없음). 로컬 테스트 DB에만 넣는다.
import fs from 'node:fs';
const BASE = 'http://localhost:3000';
const jar = {};
async function api(who, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', origin: BASE, cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const SA = 'superadmin', PW = 'Promo!2345', NPW = 'Promo!Demo77';
try { await api(SA, 'POST', '/api/login', { username: SA, password: PW }); await api(SA, 'POST', '/api/password', { current: PW, next: NPW }); }
catch { await api(SA, 'POST', '/api/login', { username: SA, password: NPW }); }
const u = (username, name, role, class_name) => api(SA, 'POST', '/api/users', { username, name, role, password: 'Demo!2345', class_name }).catch(e => console.log(e.message));
await u('teacher.kim', '김모아', 'instructor');
await u('teacher.lee', '이하늘', 'instructor');
await u('admin.park', '박운영', 'admin');
const names = ['김서준','이하윤','박도윤','최서아','정지호','강하은','조민준','윤지유','장예준','임수아','한시우','오채원'];
for (let i = 0; i < names.length; i++) await u(`stu${String(i+1).padStart(2,'0')}`, names[i], 'student', i < 6 ? '중1-1반' : '중1-2반');
// 덱
const mk = b => api(SA, 'POST', '/api/decks', b);
const d1 = await mk({ title: 'AI 시대, 나의 진로 찾기', description: '좋아하는 것·잘하는 것에서 출발하는 진로 탐색 1차시', subject: '진로 탐색' });
for (const f of fs.readdirSync('slides').sort()) await api(SA, 'POST', `/api/decks/${d1.id}/import-image`, { data: 'data:image/jpeg;base64,' + fs.readFileSync('slides/' + f).toString('base64') });
const html = fs.readFileSync('jobcards.html', 'utf8');
const d2 = await mk({ title: '직업 카드 탐색 웹앱', description: 'AI로 만든 체험형 웹앱 (HTML 업로드)', subject: '진로 탐색', kind: 'html', html });
const d3 = await mk({ title: '미래 직업 인터뷰 PPT', description: '직업인 인터뷰 준비 2차시', subject: '직업 체험' });
const d4 = await mk({ title: 'AI 이미지 만들기 체험', description: '외부 체험형 웹앱', subject: 'AI 체험', kind: 'link', external_url: 'https://example.com/ai-image', cost_type: 'api', api_provider: 'OpenAI', unit_cost: 30 });
const d5 = await mk({ title: '나의 강점 찾기 워크북', description: '강점 카드 활동', subject: '직업 체험' });
for (const id of [d1.id, d2.id, d3.id, d4.id, d5.id]) await api(SA, 'PATCH', `/api/decks/${id}`, { published: true, target_classes: '중1-1반,중1-2반' }).catch(e => console.log(e.message));
fs.writeFileSync('ids.json', JSON.stringify({ d1: d1.id, d2: d2.id, d3: d3.id, d4: d4.id, d5: d5.id }));
// 시간표
await api(SA, 'POST', '/api/schedules', { day_of_week: 2, start_time: '19:00', end_time: '20:00', deck_id: d2.id });
await api(SA, 'POST', '/api/schedules', { day_of_week: 4, start_time: '19:00', end_time: '20:30', deck_id: d1.id });
console.log('ok', d1, d2);
