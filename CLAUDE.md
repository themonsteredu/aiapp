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
| `/` | 랜딩 (`public/index.html` + `public/landing.css` + `public/landing.js`) |
| `/class`, `/class/*` | 플랫폼 SPA (`public/app.html` + `public/app.js`) |
| `/class#/p/<슬러그>` | 학생에게 배포되는 프로젝트 웹앱 |
| `/api/*` | Node 서버 (`server.js` → `lib/api.js`) |

- 라우팅 규칙은 **`vercel.json`과 `server.js` 양쪽에 같이** 넣는다. 한쪽만 고치면 Vercel과 로컬 동작이 갈린다
- Vercel 프레임워크는 **`node`**이며 `server.js`가 API를 처리한다. 일반 `/api/*`를 `/api/index`로 rewrite하면 원래 요청 주소가 사라져 로그인 등 모든 API가 404가 된다. API 경로는 그대로 전달한다.
- 이 앱은 **해시 라우팅**이다. 루트를 랜딩으로 바꾸면서 예전 `/#/...` 링크가 죽지 않도록, 랜딩 `<head>`에 `#/`로 시작하는 해시만 `/class`로 넘기는 스크립트를 둔다. 페이지 내부 앵커(`#core` 등)는 건드리지 않는다
- 공유 링크 형태를 바꿀 때는 **서버에서 QR을 만드는 `lib/project-api.js`의 `publicAppUrl()`**, 배포 API 응답의 `url`, `public/project-ui.js`의 주소 표기를 함께 고친다

## 업로드형 HTML 웹앱 샌드박스

- 강사가 올린 HTML 웹앱(`decks.kind='html'`)은 플랫폼과 같은 주소(`/api/webapp/<id>`)에서 나간다. **같은 출처로 돌면 보는 사람의 로그인으로 진로기록·학생 기록·관리자 API를 부를 수 있으므로 불투명 출처로 격리한다. `allow-same-origin`을 다시 넣지 않는다**
- 화면은 `public/app.js` `mountWebappFrame`이 HTML을 `fetch`로 받아 `allow-same-origin` 없는 `sandbox` iframe의 **`srcdoc`**으로 넣는다. `src`로 넣지 않는다 — 불투명 출처 문서를 다시 읽을 때 SameSite=Strict 세션 쿠키가 안 실려 401. 주소로 바로 열면 응답 헤더 `Content-Security-Policy: sandbox …`(`webappHeaders`)가 같은 격리를 건다
- **두 곳이 같아야 한다**: `WEBAPP_SANDBOX`(iframe sandbox = CSP sandbox 토큰)·저장 표식·`WEBAPP_ALLOW`·`LINK_ALLOW`·`LINK_ALLOW_MEDIA`(iframe `allow`)가 `lib/webapp-sandbox.js`와 `public/app.js`에 따로 있다. 한쪽만 바꾸면 플랫폼 화면과 직접 열기가 다르게 돈다 (`test/webapp-sandbox.test.js`가 두 파일의 값을 맞춰 본다)
- 막히는 `localStorage`·`sessionStorage`·`document.cookie`·`reportApiUsage()`는 서버가 HTML 첫 스크립트로 넣는 보조 스크립트(`injectSandboxShim`, doctype 뒤·`<head>` 첫머리)가 대신한다. 저장 내용은 `window.name`과 `postMessage`로 부모가 보관한다 — localStorage 는 부모 localStorage `moalab:webapp:<사용자>:<웹앱>`(JSON 1,000,000자까지), sessionStorage 는 부모 페이지 메모리(5분마다 iframe을 다시 만들어도 이어진다). 새 iframe 에는 `name`으로 돌려주며 **`name`은 문서에 붙이기 전에 정한다**(크롬은 붙인 뒤 바꾼 값을 안 넘긴다). 부모는 그 iframe·그 웹앱 번호의 메시지만 받는다
- `<base href="about:srcdoc">`는 **srcdoc 끝에만** 붙인다. 없으면 `#앵커` 링크가 부모 주소 기준이라 iframe을 플랫폼 화면으로 바꾼다. 앞에 두면 앱의 `//cdn…` 스크립트·자기 `<base>`가 깨진다. 직접 열기 응답에는 넣지 않는다
- **알려진 제약**: 업로드형 앱에서는 카메라·마이크(`getUserMedia`)·IndexedDB 가 안 되고 `location`은 `about:srcdoc`, 읽기를 마친 뒤의 상대 주소는 풀리지 않는다. 자세한 건 `docs/job-career-log.md` 2026-10-02 항목
- **카메라·마이크는 외부 링크(`kind='link'`) + 자료별 `decks.media_access`로만** 연다(기본 끔, 자료 주인·관리자만 바꾸며 접속 기록에 남는다, 켠 자료만 `LINK_ALLOW_MEDIA`). 크롬은 학생이 플랫폼에 준 카메라 허용을 위임받은 iframe 과 함께 쓰므로 **모든 링크에 기본으로 열지 않는다**
- 앱이 여는 새 창은 `allow-popups-to-escape-sandbox`로 샌드박스를 벗는다(외부 사이트의 저장소·로그인이 깨지지 않게). 새 창에서 `/api/webapp/<id>`를 열어도 CSP sandbox 가 다시 걸린다
- `/api/assets/<id>`는 `text/html` 자산에 404 — 웹앱 HTML 도 `assets`에 있어 그 경로로 열면 샌드박스 없이 같은 출처로 돈다. DB 에서 직접 내주는 자산 응답에는 `X-Content-Type-Options: nosniff`

## 브랜드

- 심볼: `public/brand/moakit-symbol.svg` — pinpoint의 `apps/portal/public/brand/moakit-symbol.svg`와 같은 파일. 랜딩·사이드바·로그인 마크가 공유한다
- 색 토큰: `public/style.css`의 `--brand-900/800/700`(모아킷 다크), `--brand-600 #0a6f61`(텍스트·버튼 겸용, 6.07:1), `--brand-500 #17b6a0`, `--accent-600 #5b8def`. 랜딩은 인라인 스타일에 같은 값
- **브랜드는 티일 한 계열, 따뜻한 색은 행동 유도 한 곳에만.** 랜딩의 주 행동 버튼(교육 프로그램 보기·교육 문의·구매 문의)은 테라코타 `#b04a12` + 흰 글자(5.48:1). 예전 오렌지 `#ff8a3d`는 흰 글자가 2.35:1이라 CTA 로 못 쓴다
- 새 강조색을 만들지 않는다 — 화면에 남는 색은 티일 계열 + 테라코타뿐이다
- **상태색(초록·빨강·주황·앰버)은 허용/차단/경고를 뜻하는 의미색이라 브랜드색으로 덮지 않는다.** 슬라이드 발표 테마(`.theme-violet` 등)도 사용자가 고르는 영역이라 그대로 둔다
- 한글은 `word-break: keep-all` 필수 — 없으면 헤드라인이 어절 중간에서 잘린다

## 랜딩 이미지와 모션

- 프로그램 카드는 `public/brand/landing/program-*.jpg`의 고해상도 에디토리얼 수업 사진 3장을 중복 없이 사용한다
- 히어로는 ThreeUI의 `Ribbon Field` 계열 배경과 `Kage`의 에디토리얼 여백·인덱스 구성을 시각적으로 참고한다. 경량 Canvas2D 실크 리본 위에서 `public/brand/showcase/*.jpg` 웹앱 4개를 한 화면씩 보여주며 외부 런타임 의존성은 추가하지 않는다
- 웹앱은 5초마다 옆으로 자동 전환한다. 여러 창을 겹치거나 무한 가로 띠를 다시 만들지 않는다
- 히어로는 강제 줄바꿈 없이 짧은 제목·설명 한 문장·대표 CTA 하나만 둔다. 웹앱 주변에는 현재 웹앱명과 `01/04` 조작 정보만 남긴다
- 자동 전환은 마우스 오버·키보드 포커스·화면 밖·탭 비활성화 시 정지하고, `prefers-reduced-motion`에서는 자동 재생하지 않는다. 캔버스 모션도 같은 조건에서 멈춘다
- 랜딩 한글 폰트는 jsDelivr의 S-Core Dream 고정 버전(`noonfonts_six@1.2`)을 사용한다

## 학생 계정 (모아허브 공통)

- 모아허브가 발급한 학교 학생 계정(아이디 `m`+16진수 20자, 중앙 테이블 `moakit_accounts`)은 모아랩 로그인에도 그대로 쓴다. 로직은 `lib/school-accounts.js`, 설계는 `docs/job-career-log.md` 하단. `users.school_account_id`로 연결하고 비밀번호는 중앙 계정에서만 검증한다 — 모아랩 `users.password_hash`에는 로그인 가능한 값을 넣지 않는다
- 진로기록 `student_id`는 계정의 `career_student_id`다. 학교 수업(모아허브)과 진로 수업(모아랩) 기록이 같은 번호로 모이는 근거이므로 `job_identities`로 우회하지 않는다
- 비밀번호 형식(`scrypt1:salt:key`, N=32768)과 잠금 규칙은 모아허브 `lib/student-accounts/security.js`와 같아야 한다. 한쪽만 바꾸면 다른 쪽 로그인이 깨진다
- **모아랩도 학교·기관 학생 계정을 발급한다** (`#/school-accounts`, `lib/school-registry.js` + `lib/school-registry-api.js`). 발급 주체는 `managers.issuer='moakit-lab'`. 학교를 모아허브에 열어 주는 표는 `moakit_accounts.school_access` — 정의는 teacher-s-project `db/moakit-accounts-0002-school-access.sql`. 명단 규칙(`lib/school-roster.js`, `public/school-roster.js`)은 모아허브 `roster.js`·`account-roster.js` 복사본이라 한쪽을 고치면 다른 쪽도 맞춘다
- **학생 기록 열람·수정**(`#/student-records`): 관리자는 모든 학교, 강사·진로업체 담당자는 `moakit_accounts.record_access` 권한(열람만/열람+수정)을 받은 학교만. 기록 원본은 append-only 라 **정정은 `supersedes_id`로 잇는 새 레코드**이고 목록은 최신 버전만 보여준다(`NOT EXISTS` 조건 — 학생 본인 목록과 모아허브 `readRecords`도 같은 조건). 설계는 `docs/job-career-log.md` 하단

## 진로업체 담당자와 진로 관찰 기록

- **역할 `partner`(진로업체 담당자)는 강사보다 낮다** (`ROLE_LEVEL`의 0.5 — `lib/auth.js`와 `public/app.js`에 같은 값). 강사용 API는 서열로 막히지만 학생용 경로(`minRole: 'student'`)는 서열만으로 열리므로 **`lib/api.js`의 `PARTNER_ALLOW` 화이트리스트가 최종 방어선이다.** 기록 관련 API를 새로 만들면 이 목록에 같이 넣는다 (`test/partner-access.test.js`)
- 계정은 관리자만 발급한다(`#/partners`). 계약·보안 동의 대상이 아니다 — 동의 화면이 강사 전용이라 걸면 아무것도 못 하는 계정이 된다
- **진로 관찰 기록**(`program_ref='job-career-observation'`)은 학생의 3칸과 저장 칸을 공유하되 `raw_data.job.observation`(`activity`/`strengths`/`next_step`)으로 무엇을 적은 칸인지 남긴다. 정정본은 `entry_kind='revision'`이 되므로 `observation_kind`도 함께 본다
- **활동 사진은 모아랩 쪽 `career_record_photos`에 넣는다** — `career_log.records`는 append-only 라 거기에 붙이지 않는다. 목록 응답에는 `{id, mime, caption}`만 싣고 이미지는 `GET /api/career-photos/<id>`로만 연다(학생 본인 = 자기 `student_uuid`, 담당자 = `record_access` 있는 학교). 정정하면 `keep_photo_ids`로 고른 사진만 새 버전으로 복사되고 이전 버전에는 전부 남는다
- **사진 크기는 Vercel 요청 본문 4.5MB 한도가 정한다.** 장당 상한만 두면 여러 장을 올릴 때 요청이 잘려 핸들러에 닿지도 않는다 — 장당(900,000자)과 **한 요청 합계**(3,200,000자)를 함께 막고, 브라우저(1280px·JPEG 0.75, 크면 단계적으로 더 축소)도 같은 값을 쓴다. 한쪽만 바꾸면 사용자에게는 이유 없는 실패로 보인다
- 정정(`reviseRecord`)은 `addRecord` 와 같은 규칙을 받아야 한다 — 관찰 기록이 아니면 사진 거부, 장수는 **이어받는 것 + 새로 넣는 것**을 합쳐서 센다
- **담당자 저장(추가·정정·반 전체 기록)도 `attempt_id`로 한 번만 남는다.** 다시 보낸 같은 내용은 200 `duplicate: true`, 같은 시도 번호에 다른 내용이면 추가는 409 `code: 'attempt_conflict'`(정정은 '이미 정정된 기록' 409). 화면은 연결이 끊긴 실패만 '저장 확인 필요'로 두고 같은 번호로 다시 보내므로(`classifySaveError`), 반 전체 기록은 저장됐거나 확인이 필요한 학생이 있으면 제목·날짜·웹앱을 잠근다(`bulkSharedLocked`) — 바꾼 채 다시 보내면 저장된 학생이 모두 409 가 된다
- **사진 더하기**는 `POST …/records/<id>/photos`(`addPhotos`) — 정정을 만들지 않고 `career_record_photos`에만 넣는다. 같은 내용 사진은 건너뛰고(재시도해도 두 번 안 붙는다) 장수는 이미 붙은 것까지 센다. 반 전체 기록은 4.5MB 한도 때문에 사진을 받지 않고 이 경로로 안내한다. 경로가 `/records/` 아래라 `PARTNER_ALLOW`에 이미 걸린다 — **기록 경로를 `/records/` 밖에 만들면 목록에 따로 넣어야 한다**
- **웹앱 잇기**(`deck_id`, 관찰 기록에만): 아무 웹앱이나 잇는 것은 **관리자만**, 강사·진로업체 담당자는 그 학생이 기록을 남긴 웹앱(`job-deck:<id>`)만 — 볼 수 없는 웹앱 제목이 기록에 실려 새지 않게. 이 확인은 웹앱 조회보다 먼저다(없는 번호와 남의 웹앱이 같은 403). 화면도 `GET /api/decks`와 반 전체 기록의 웹앱 칸은 관리자만
- **반 전체 기록**은 새 API 없이 학생마다 기록 추가 API를 차례로 부른다(줄마다 `attempt_id`). 작성 내용은 `sessionStorage`에만 — 공용 아이패드라 `localStorage`에 두지 않는다
- **쓴 사람과 고친 사람을 나눈다**: 정정해도 `author_name`은 처음 쓴 사람 그대로, 고친 사람은 `revised_by`·`revised_by_name`(늘 값을 둔다). 담당자 기록인지는 `program_ref`로 가린다(정정본 `entry_kind`는 늘 `revision`). 학생 글의 정정본에는 `author_name`을 넣지 않는다
- **학생 화면 표시는 모아허브와 같은 규칙이다**: 관찰은 학교 선생님이 아니라 진로 강사가 쓴다 — `진로 강사 관찰`·`강사가 본 나의 강점·흥미`, 제목은 `job.title`(웹앱 이름은 제목이 아니라 `웹앱:` 줄), 쓴 사람 줄 `작성: A · 정정: B`/`정정: B`. 모아랩 `public/career-log-ui.js`(`recordHeading`·`recordDeckLine`·`recordWriter`, 담당자 화면도 `recordWriter`) ↔ 모아허브 `teacher-s-project public/student-accounts.js`(`observationOf`·`writerOf`). 모아허브는 `artifact`를 제목으로 쓰므로 관찰 기록을 `observationOf()`로 가려낸다. **한쪽 문구·규칙을 바꾸면 다른 쪽도 맞춘다** — 설계는 `docs/job-career-log.md` 2026-10-02 항목

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
