# CLAUDE.md

**모아랩(MoaLab)** — `job.moakit.ai`. 모아킷의 AI 수업·진로교육 서비스다.
모아킷은 사업자명이자 우산 브랜드이고, 모아랩은 그 안의 사업 분야다. **독립 업체로 읽히면 안 된다.**

기능 명세는 `README.md`, Supabase·배포 절차는 `DEPLOY.md`에 있다. 이 문서는 **작업할 때 걸리는 것**만 적는다.

## 배포

- Vercel 프로젝트 `aiapp` (팀 `themonsteredu`)
- **프로덕션 브랜치는 `main`이 아니라 `claude/career-education-webapp-xem8ui`다.** PR base를 여기로 잡아야 배포된다
- 형제 레포: `themonsteredu/pinpoint`(모아킷 홈 `moakit.ai`, 브랜드 원본), `themonsteredu/teacher-s-project`(모아허브 `hub.moakit.ai`)

## 주소 구조

| 주소 | 내용 |
|---|---|
| `/` | 랜딩 (`public/index.html` — 단일 파일, CSS·스크립트 인라인) |
| `/class`, `/class/*` | 플랫폼 SPA (`public/app.html` + `public/app.js`) |
| `/class#/p/<슬러그>` | 학생에게 배포되는 프로젝트 웹앱 |
| `/api/*` | 서버리스 (`api/index.js` → `lib/api.js`) |

- 라우팅 규칙은 **`vercel.json`과 `server.js` 양쪽에 같이** 넣는다. 한쪽만 고치면 Vercel과 로컬 동작이 갈린다
- 이 앱은 **해시 라우팅**이다. 루트를 랜딩으로 바꾸면서 예전 `/#/...` 링크가 죽지 않도록, 랜딩 `<head>`에 `#/`로 시작하는 해시만 `/class`로 넘기는 스크립트를 둔다. 페이지 내부 앵커(`#core` 등)는 건드리지 않는다
- 공유 링크 형태를 바꿀 때는 **서버에서 QR을 만드는 `lib/project-api.js`의 `publicAppUrl()`**, 배포 API 응답의 `url`, `public/project-ui.js`의 주소 표기를 함께 고친다

## 브랜드

- 심볼: `public/brand/moakit-symbol.svg` — pinpoint의 `apps/portal/public/brand/moakit-symbol.svg`와 같은 파일. 랜딩·사이드바·로그인 마크가 공유한다
- 색 토큰: `public/style.css`의 `--brand-900/800/700`(플럼 아닌 모아킷 다크), `--brand-600 #0e8f7e`, `--brand-500 #17b6a0`, `--accent-600 #5b8def`. 랜딩은 인라인 스타일에 같은 값
- **상태색(초록·빨강·주황·앰버)은 허용/차단/경고를 뜻하는 의미색이라 브랜드색으로 덮지 않는다.** 슬라이드 발표 테마(`.theme-violet` 등)도 사용자가 고르는 영역이라 그대로 둔다
- 한글은 `word-break: keep-all` 필수 — 없으면 헤드라인이 어절 중간에서 잘린다

## 히어로 쇼케이스

랜딩 히어로 우측은 실제 수업 웹앱 첫 화면이 가로로 흐르는 띠다.

- 이미지: `public/brand/showcase/*.jpg` — **800×500 (16:10) 통일**, JPEG q80. 세로 캡처는 헤드라인이 살아 있는 구간으로 창을 잡아 자른다
- 카드 목록은 `index.html`의 `.showcase-track`에 **같은 세트를 두 벌** 넣어 이음매 없이 순환시킨다(두 번째 벌은 `aria-hidden`). 장수를 늘리면 `showcase-roll` 애니메이션 시간도 같이 늘린다
- 마우스 오버 시 정지, `prefers-reduced-motion`이면 애니메이션 없음

## 문구 원칙

랜딩은 외부 시안에서 이식한 것이라 **사실이 아닌 문구가 섞여 있었다.** 문구를 넣거나 시안을 옮길 때 반드시 확인한다.

- 성과 수치(누적 학생 수 등)는 실제 값이 없으면 넣지 않는다 — 가짜 수치 섹션을 실제로 제거한 이력이 있다
- 아직 안 한 일을 완료형으로 쓰지 않는다. 예시는 "· 예시" 배지와 진행형 서술로
- 가격 미정은 자리표시자 숫자 대신 "가격 준비 중"
- 푸터에는 **모아킷** 사업자 정보(상호·대표·사업자등록번호·이메일)와 형제 제품 링크가 있어야 한다

## 확인

```bash
npm run check                     # 전 파일 구문 검사
DATABASE_URL='postgresql://u:p@127.0.0.1:5432/none' PORT=3999 node --no-warnings server.js
# 더미 DB로도 정적 라우팅은 확인된다: / (랜딩) · /class (SPA 셸) · /brand/... · /style.css
```

이 컨테이너는 외부 사이트 직접 접속이 막혀 있다. 배포 확인은 Vercel MCP(`list_deployments`, `web_fetch_vercel_url`)로, 화면 확인은 로컬 서버 + 헤드리스 크롬으로 한다.
