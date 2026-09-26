# 모아랩 홍보영상

- `moalab-promo.mp4` — 1920×1080, 30fps, 약 57초, 배경음악 + 하단 한국어 자막 포함
- 실제 앱 화면(PPT 웹앱 발표·워터마크, 6자리 수업 입장 코드와 학생 참여, 요일·시간 접근 제어, 보안 설정, 6차시 AI 웹앱 프로젝트, 운영 대시보드)을 녹화해 자막과 함께 편집했습니다.
- 화면에 나오는 학생·강사 이름, 수업 자료, 학교명은 모두 녹화용으로 만든 **가짜(예시) 데이터**입니다. 실제 개인정보는 없습니다.
- `moalab-promo.srt` — 자막 파일 (유튜브 등에 따로 올릴 때 사용)
- `source/` — 다시 만들 때 쓰는 녹화·편집 스크립트 (앱 배포에는 포함되지 않음)

## 다시 만들기 (개발자용)

1. 빈 로컬 Postgres 로 앱 실행: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/moalab SUPERADMIN_PASSWORD='Promo!2345' npm start`
2. `source/` 에서 `bash build.sh record` — 예시 슬라이드 생성 → 더미 데이터 입력(`seed.mjs`, `seed-project.mjs`) → 화면 녹화(`go.mjs`) → 편집 렌더(`compose.html` + `render.mjs`) → 배경음악 합성(`music.py`, 직접 합성이라 저작권 문제 없음) → mp4 합치기
3. 편집만 다시 할 때는 `bash build.sh` (녹화 프레임 `frames/` 가 남아 있어야 함)

필요한 것: Node 22, Playwright(Chromium), Python3 + numpy, ffmpeg, Pretendard 글꼴. 녹화 중간 파일(`clips/`, `frames/`, `out/`)은 저장소에 넣지 않습니다.
