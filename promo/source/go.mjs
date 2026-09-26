// 실제 앱 화면 녹화 — 로컬 서버 + 더미 데이터(seed.mjs) 기준
import { browser, newPage, record, BASE } from './rec.mjs';
const w = ms => new Promise(r => setTimeout(r, ms));
const which = process.argv[2];
const b = await browser();
async function login(p, u = 'superadmin', pw = 'Promo!Demo77') {
  await p.goto(BASE + '/class#/login'); await w(700);
  await p.click('[data-ltab=account]'); await w(200);
  await p.fill('input[name=username]', u); await p.fill('input[type=password]', pw);
  await p.keyboard.press('Enter'); await w(1500);
}
async function smooth(p, dy, ms) { const n = Math.round(ms / 33); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy / n); await w(33); } }
const p = await newPage(b);
if (which === 'landing') {
  await p.goto(BASE + '/'); await w(2500);
  await record(p, 'landing', async () => { await w(10500); });
}
if (which === 'decks') {
  await login(p); await p.goto(BASE + '/class#/decks'); await w(1500);
  await record(p, 'decks', async () => {
    await w(1400);
    await p.locator('a[href="#/view/1"]').first().click();
    await w(2200);
    for (let i = 0; i < 3; i++) { await p.locator('button:has-text("다음")').first().click(); await w(1500); }
    await w(600);
  });
}
if (which === 'session') {
  await login(p); await p.goto(BASE + '/class#/sessions'); await w(1500);
  await record(p, 'session', async () => {
    await w(800);
    await p.locator('#cs-form input[name=title]').pressSequentially('모아중학교 1-1반 진로 1차시', { delay: 90 }); await w(400);
    for (const t of ['AI 시대, 나의 진로 찾기', '직업 카드 탐색 웹앱']) { await p.locator('label', { hasText: t }).locator('input[type=checkbox]').check(); await w(450); }
    await w(300); await p.locator('#cs-form button[type=submit]').click(); await w(3200);
  });
  const code = (await p.locator('[data-big]').first().textContent()).trim();
  (await import('node:fs')).writeFileSync('code.txt', code); console.log('code', code);
}
if (which === 'join') {
  const code = (await import('node:fs')).readFileSync('code.txt', 'utf8').trim();
  await p.goto(BASE + '/class#/login'); await w(1500);
  await record(p, 'join', async () => {
    await w(700);
    await p.locator('#join-code').pressSequentially(code, { delay: 160 }); await w(700);
    await p.locator('input[name=name]').pressSequentially('김서준', { delay: 180 }); await w(500);
    await p.click('button[type=submit]'); await w(3200);
    await p.locator('a:has-text("체험 시작"), button:has-text("체험 시작")').first().click(); await w(2200);
    await p.mouse.move(700, 450); await w(200);
    const f = p.frameLocator('iframe').first();
    for (const t of ['로봇 엔지니어', '데이터 분석가', 'AI 콘텐츠 디자이너']) { await f.getByText(t).first().click({ timeout: 4000 }).catch(e => console.log('miss', t)); await w(600); }
    await w(1200);
  });
}
if (which === 'schedule') {
  await login(p); await p.goto(BASE + '/class#/schedules'); await w(1500);
  await record(p, 'schedule', async () => {
    await w(900);
    const form = p.locator('form').first();
    await form.locator('select').first().selectOption({ label: '수요일' }); await w(500);
    await form.locator('input[type=time]').nth(0).fill('19:00'); await w(300);
    await form.locator('input[type=time]').nth(1).fill('20:30'); await w(300);
    await form.locator('select').nth(1).selectOption({ label: '미래 직업 인터뷰 PPT' }).catch(async () => {
      const opts = await form.locator('select').nth(1).locator('option').allTextContents(); console.log(opts); }); await w(600);
    await p.getByRole('button', { name: /추가/ }).first().click(); await w(3000);
  });
}
if (which === 'blocked') {
  await login(p, 'stu01', 'Demo!2345'); await w(1200);
  await record(p, 'blocked', async () => { await w(5000); });
}
if (which === 'security') {
  await login(p); await p.goto(BASE + '/class#/security'); await w(1500);
  await record(p, 'security', async () => {
    await w(1000);
    await p.locator('label.toggle:has(input[data-setting=single_session])').click(); await w(1400);
    const wm = p.locator('input[value*="{이름}"]').first();
    await wm.click().catch(() => {}); await p.keyboard.press('End'); await p.keyboard.type(' · 무단유출금지', { delay: 70 }); await w(2200);
  });
}
if (which === 'projteacher') {
  await login(p); await p.goto(BASE + '/class#/projects/1'); await w(1500);
  await record(p, 'projteacher', async () => { await w(1500); await smooth(p, 420, 2200); await w(2200); });
}
if (which === 'projstudent') {
  await p.goto(BASE + '/class#/login'); await w(800);
  await p.fill('#join-code', '822163'); await w(900);
  await p.fill('input[name=team_code]', '6159'); await p.fill('input[name=anonymous_no]', 'A01');
  await p.click('button[type=submit]'); await w(2000);
  await p.goto(BASE + '/class#/project/3'); await w(1800);
  await record(p, 'projstudent', async () => {
    await w(800);
    const ta = p.locator('textarea').first(); await ta.click();
    await ta.pressSequentially('사용자가 정말 필요로 하는 정보가 무엇인지 먼저 물어볼 것 같아요.', { delay: 55 }); await w(700);
    const tb = p.locator('textarea').nth(1); await tb.click();
    await tb.pressSequentially('자료가 맞는지 공식 출처로 확인하는 것!', { delay: 60 }); await w(1500);
  });
}
if (which === 'dashboard') {
  await login(p); await p.goto(BASE + '/class#/'); await w(2000);
  await record(p, 'dashboard', async () => { await w(1600); await smooth(p, 520, 2400); await w(2000); });
}
await b.close();
