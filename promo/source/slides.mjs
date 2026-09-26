// 녹화용 예시 수업 슬라이드 이미지를 만든다 (PPT에서 내보낸 PNG 대신 사용)
import { chromium } from 'playwright';
import fs from 'node:fs';
const S = [
  ['01', 'AI 시대, 나의 진로 찾기', '오늘은 내가 좋아하는 것과 잘하는 것에서 출발해요', '#0a6f61'],
  ['02', '10년 뒤, 직업은 어떻게 바뀔까?', '사라지는 일보다 새로 생기는 일이 더 많아요', '#0b3b36'],
  ['03', '나를 알아보는 세 가지 질문', '좋아하는 것 · 잘하는 것 · 중요하게 여기는 것', '#17b6a0'],
  ['04', 'AI와 함께 일하는 직업들', '데이터 분석가 · 로봇 엔지니어 · 디지털 헬스케어', '#0a6f61'],
  ['05', '직업 카드로 탐색하기', '관심 가는 카드 3장을 골라 이유를 적어요', '#0b3b36'],
  ['06', '오늘의 진로 기록', '배운 점과 다음에 알아볼 것을 남겨요', '#17b6a0'],
];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
fs.mkdirSync('slides', { recursive: true });
for (const [n, t, s, c] of S) {
  await p.setContent(`<html><body style="margin:0;width:1600px;height:900px;font-family:Pretendard;background:linear-gradient(135deg,${c},#062b27);color:#fff;position:relative;overflow:hidden;word-break:keep-all">
  <div style="position:absolute;right:-160px;top:-160px;width:640px;height:640px;border-radius:50%;background:rgba(255,255,255,.07)"></div>
  <div style="position:absolute;right:120px;bottom:-220px;width:420px;height:420px;border-radius:50%;background:rgba(23,182,160,.25)"></div>
  <div style="position:absolute;left:120px;top:110px;font-size:34px;font-weight:700;letter-spacing:.1em;color:#9fe8dc">진로 수업 · ${n}</div>
  <div style="position:absolute;left:120px;top:300px;width:1200px;font-size:96px;font-weight:800;line-height:1.15;letter-spacing:-.03em">${t}</div>
  <div style="position:absolute;left:120px;top:560px;width:1200px;font-size:44px;font-weight:500;color:#d6f3ee">${s}</div>
  <div style="position:absolute;left:120px;bottom:90px;font-size:28px;color:#9fe8dc;font-weight:600">모아랩 · 예시 수업 자료</div></body></html>`);
  await p.screenshot({ path: `slides/${n}.jpg`, type: 'jpeg', quality: 88 });
}
await b.close();
