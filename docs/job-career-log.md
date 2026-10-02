# JOB 진로기록 직접 작성·조회

학생은 `/class#/career-records`에서 수업의 활동 과정·결과물 설명·돌아보기를 작성합니다. 자료 뷰어의 `활동 기록 남기기`는 해당 수업을 선택한 작성 화면으로 연결됩니다. 강사는 같은 메뉴에서 담당 수업 기록을 조회하고 수업별로 필터링합니다.

## 데이터와 인증

- 운영 Career Log의 `career_log.students`, `career_log.records`를 기존 JOB 서버의 Postgres 연결로 사용합니다. 기존 원본 수정 금지 트리거를 유지합니다.
- 신규 `career_log.job_identities`는 서버 전용입니다. RLS를 켜고 PUBLIC/anon/authenticated 권한을 회수합니다. 이름·학번·학교로 학생 UUID를 만들지 않습니다.
- 계정 학생은 JOB 내부 사용자 ID에 연결한 무작위 UUID를 재사용합니다.
- 수업 코드 학생은 무작위 256비트 기기 연결 값을 HttpOnly/Secure/SameSite=Strict 쿠키에 보관합니다. DB에는 그 해시만 저장합니다. 현재 로그인 세션에 연결한 별도 쿠키가 있어야 기록을 읽거나 쓸 수 있습니다.
- 다른 로그인 세션에서는 먼저 `이전 기록 이어가기` 또는 `새로 시작`을 선택합니다. 프로젝트 팀코드·익명번호를 아는 것만으로 이전 기록을 읽을 수 없습니다.
- 기기 연결 쿠키는 90일이며, 다른 기기·브라우저 및 사이트 데이터 삭제 후에는 복구되지 않습니다. 수업 코드 학생은 열린 수업에 참여한 동안 조회할 수 있습니다. 공용 기기 사용 후에는 로그아웃합니다.
- 기존 Hub의 브라우저 UUID를 이름 또는 URL 값으로 JOB 계정에 자동 연결하지 않습니다. Hub와의 검증된 계정 연결은 별도 단계입니다.

## 저장 규격

`source=job`, `program_ref=job-deck:<실제 자료 ID>`, `session_ref=job-class:<실제 수업 ID>`를 서버에서 정합니다. 계정 수업은 `job-account-deck:<자료 ID>`로 구분합니다. `raw_data.job`에는 작성 방식, 수업/자료 이름, 표시 이름과 담당 강사 ID를 서버에서 넣습니다. 클라이언트가 보낸 학생 ID·담당자·검증 상태는 사용하지 않습니다. 저장은 학생 역할, 활성 인증, 기존 시간 제한, 실제 자료 배정·공개·잠금 규칙을 통과해야 합니다.

첫 요청과 재시도는 같은 `attempt_id`를 사용합니다. `(학생 UUID, attempt_id)`로 만든 이벤트 키를 트랜잭션 advisory lock으로 잠근 뒤 조회·삽입합니다. 같은 내용은 기존 접수번호를 반환하고, 같은 요청 ID의 다른 내용은 409로 거절합니다. 검증 상태는 null이며 학생 직접 작성으로 표시합니다. 원본을 UPDATE/DELETE하지 않습니다.

학생 조회는 서버에서 확인한 본인 UUID로만 제한합니다. 강사 조회는 서버가 기록한 담당 강사 목록에 포함된 수업으로 제한하고, 관리자 이상은 JOB 기록 전체를 조회합니다. 클라이언트의 학생 ID나 필터 값으로 범위를 넓힐 수 없습니다. 모든 응답은 private/no-store입니다.

## 적용 범위

이번 연결은 **학생 직접 작성 기록**입니다. 외부 체험 앱의 진행 결과 자동 수집, 파일·사진 업로드, Hub 기록 통합 조회는 포함하지 않습니다. 랜딩의 문서 예시는 계속 예시로 표시하고, 실제 기록 입구를 별도로 제공합니다.

(이후 Hub 기록 통합 조회는 2026-09-12, 담당자의 활동 사진은 2026-09-14 항목에서 더했다. 웹앱 진행 결과의 자동 수집은 여전히 없고, 담당자가 관찰 기록을 학생의 웹앱 활동에 손으로 잇는다 — 2026-10-02 항목.)

## DB 적용·검증

- Supabase 프로젝트 `vypnobpmyadtcvxhtagn`
- 적용 migration: `20260906130333 / job_career_log_identity_links`
- SQL: `db/job-career-log.sql`
- `npm run check`, `npm test`: 구문 검사 및 35개 테스트 통과.
- Vercel Node 서버에 맞춰 일반 API rewrite를 제거했습니다. 로그인·진로기록 경로, 쿼리·본문 전달과 `/class` 정적 셸을 라우팅 회귀 테스트로 검증합니다.
- 실제 DB 트랜잭션에서 학생·매핑·기록 생성, 본인/담당 강사 조회 조건, 원본 수정 차단, 공개 역할의 매핑 조회 차단을 검증했습니다. 전체 ROLLBACK 후 검증 기록 0건을 확인했습니다.
- 브라우저 연결이 반복 실패해 모바일·태블릿 실제 렌더링 및 로그인한 학생 UI의 저장 E2E는 완료하지 못했습니다. CSS 반응형 규칙과 학생/교사 입구 및 로그인 후 기록 화면 복귀 경로는 소스로 확인했습니다.

## 모아허브 학교 학생 계정으로 로그인 (2026-09-12)

한 학생의 학교 수업(모아허브) 기록과 진로 수업(모아랩) 기록을 **같은 학생 번호**로 모으기 위한 연결입니다. 코드는 `lib/school-accounts.js`.

- 모아허브가 학교별로 발급한 학생 계정(아이디 `m` + 16진수 20자, 중앙 테이블 `moakit_accounts.accounts`)으로 `/class` 로그인 창의 `계정 로그인`에 그대로 들어옵니다. 아이디 형식으로 자동 판별하며 별도 탭이나 화면은 없습니다.
- 비밀번호는 중앙 계정에서 검증합니다(모아허브와 같은 `scrypt1` 형식·같은 `login_limits` 잠금 규칙). 모아랩 `users`에는 `school_account_id`로 연결된 학생 행을 만들고, 이름·반·비밀번호 변경 요구는 로그인할 때마다 모아허브 명단 기준으로 다시 맞춥니다. 반은 `학교명 n학년 n반`으로 넣어 웹앱 배정 단위로 씁니다(번호는 개인 식별이라 제외).
- 연결된 행은 모아랩 비밀번호가 없습니다. 모아랩 관리 화면에서 이름·반·역할 변경과 비밀번호 초기화를 막고 `학교 계정` 배지로 표시합니다. `m`+20자 형식의 아이디는 모아랩에서 새로 만들 수 없습니다.
- `/api/password`는 학교 계정이면 중앙 계정의 비밀번호를 바꾸고 모아허브 학생 세션을 모두 끝냅니다(모아허브의 변경 규칙과 동일). 어느 쪽에서 바꿔도 양쪽에 적용됩니다. 모아허브에서 초기화하면 다음 모아랩 로그인 때 변경 요구가 따라옵니다. 이미 열려 있는 모아랩 세션은 최대 12시간 뒤 만료됩니다.
- 진로기록의 `student_id`는 계정의 `career_student_id`입니다. `career_log.job_identities`에 별도 번호를 만들지 않으며, `raw_data.job.identity = 'school-account'`로 표시합니다. 계정이 비활성이면 기록을 읽고 쓸 수 없습니다.
- 학생 본인 조회는 출처를 가리지 않습니다. 학교 계정 학생의 `내 진로기록`에는 모아허브 학교 수업 기록이 `모아허브 · 학교 수업` 이름표로 함께 나옵니다. 강사 조회는 이전과 같이 모아랩 기록만 담당 수업 범위로 봅니다.
- 스키마: `users.school_account_id UUID UNIQUE` (`lib/db.js` MIGRATIONS, 콜드스타트 때 자동 적용). 중앙 테이블은 바꾸지 않습니다. 모아랩 서버의 `DATABASE_URL`은 중앙 테이블과 같은 Supabase 프로젝트(`vypnobpmyadtcvxhtagn`)를 가리켜야 합니다.
- 검증: `test/school-accounts.test.js`, `test/career-log.test.js`(학교 계정 3건)와 로컬 PostgreSQL에 중앙 테이블을 재현해 로그인 → 비밀번호 변경 → 기록 저장 → 허브·랩 기록 통합 조회 → 관리자 차단까지 실제 HTTP로 확인했습니다. 운영 DB의 실제 학교 계정으로는 아직 확인하지 않았습니다.

## 모아랩에서 학교·기관 학생 계정 발급 + 제품 간 "열기" (2026-09-12)

모아허브를 쓰지 않는 학교의 학생도 처음부터 모아킷 공통 계정을 갖게 하려고, 모아허브의 학교 계정 관리와 같은 기능을 모아랩에 넣었다. 강사·관리자 메뉴 `학교 학생 계정`(`#/school-accounts`). 수업 입장 코드 흐름은 바뀌지 않는다.

- 서버: `lib/school-registry.js`(발급·관리 로직, 모아허브 `lib/student-accounts/service.js`와 같은 규칙) · `lib/school-roster.js`(명단 검증) · `lib/school-registry-api.js`(`/api/school-accounts/*`). 화면: `public/school-accounts-ui.js` + `public/school-roster.js`(모아허브 `account-roster.js` 복사) + `public/school-accounts.css`.
- 발급 주체 표시는 `moakit_accounts.managers.issuer = 'moakit-lab'`, 감사 기록의 actor 는 `moakit-lab:<강사 ID>`. 학생 번호(`career_student_id`)는 무작위 UUID이고 계정은 모아허브가 발급한 것과 구별되지 않는다 — 같은 아이디·비밀번호로 양쪽 로그인, 진로기록 한 번호.
- **제품 간 열기**: 중앙 표 `moakit_accounts.school_access (school_id, issuer)`. 행이 있으면 그 제품의 관리자(admin 이상)가 담당자 지정 없이 학교를 보고 학생을 발급·관리하며 담당 강사를 지정할 수 있다. 강사(일반)는 여전히 담당 지정이 필요하다. 모아랩 화면의 `모아허브에 열기` 체크박스 ↔ 모아허브 학교 관리 화면의 `모아랩에 열기` 체크박스. 표 정의는 teacher-s-project `db/moakit-accounts-0002-school-access.sql`, 운영 DB에는 migration `moakit_accounts_school_access`로 2026-09-12 적용 완료.
- 담당 강사 지정은 모아랩 활성 강사·관리자 계정만(학교 계정 연결 행 제외). 학교·기관 등록과 열기는 관리자만.
- 임시 비밀번호는 발급 응답에만 있고 화면 메모리에 두었다가 학교를 바꾸거나 탭이 가려지면 지운다. DB에는 해시만 남는다.
- 검증: `test/school-registry.test.js`(권한·발급·중복·열기) + 로컬 PostgreSQL에 중앙 표를 재현하고 모아랩·모아허브 서버를 함께 띄워 "모아랩 학교 등록 → 발급 → 모아허브에 열기 → 모아허브 관리자가 조회·추가 발급 → 반대 방향 열기·닫기 → 발급 학생 양쪽 로그인"을 실제 HTTP로 확인. 운영 DB의 실제 계정으로는 아직 확인하지 않았다.
- 아직 없는 것: 모아허브 없이 이미 모아랩에서 수업 코드·강사 발급 계정으로 남긴 기록(job_identities 번호)을 나중에 받은 공통 계정에 잇는 단계. 운영 DB에 그런 기록은 아직 0건이라 급하지 않다.

## 학생 기록 열람·수정 (2026-09-13)

관리자와 "기록 권한"을 받은 담당자가 한 학생의 학교 수업(모아허브)·진로 수업(모아랩) 기록 전체를 보고, 정정하거나 새 기록을 남기는 화면. 메뉴 `학생 기록 열람`(`#/student-records`), 코드는 `lib/school-registry.js`(recordLevel 이하)·`lib/school-registry-api.js`·`public/school-accounts-ui.js` 하단.

- **누가 보나**: 모아랩 관리자(admin 이상)는 중앙에 등록된 **모든 학교**를 열람·수정한다. 일반 강사는 기본적으로 아무것도 못 보고, 관리자가 학교 단위로 `열람만` 또는 `열람+수정` 권한(`moakit_accounts.record_access`, 정의 `db/moakit-accounts-record-access.sql`)을 준 계정만 그 학교를 본다. 외부 진로기관 담당자는 강사 관리에서 계정을 만든 뒤 이 권한을 준다. 권한을 받은 강사에게만 메뉴가 뜬다(`/api/me`의 `canViewRecords`).
- **수정은 새 버전**: 기록 원본은 append-only 라서 UPDATE 하지 않는다. 정정하면 `supersedes_id`로 원본을 가리키는 새 레코드(`source='job'`, `raw_data.job.entry_kind='revision'`, `revised_by`, `revised_by_name`, `original_source`)를 넣고 — 쓴 사람(`author_name`)은 처음 쓴 사람 그대로 둔다(아래 2026-10-02 항목) — 목록은 `NOT EXISTS (… supersedes_id = r.id)` 조건으로 최신 버전만 보여준다. 이미 정정된 원본을 다시 정정하면 409. 이전 버전은 `…/records/:id/history`(재귀 질의)로 본다. 학생 본인 목록(모아랩 `/api/career-log/records`, 모아허브 `readRecords`)도 같은 조건으로 최신만 보여준다.
- **기록 추가**: `program_ref='job-staff-record'`, `session_ref='job-school:<학교>'`, `raw_data.job.entry_kind='staff_record'` + 작성자(`author`, `author_name`)·제목. 학생 본인 화면에는 "담당자 작성"으로 표시된다.
- 열람(첫 페이지)·정정·추가·권한 부여/해제는 모두 `moakit_accounts.audit`에 남는다 (`records_viewed`, `record_revised`, `record_added`, `record_access_granted:<level>:<user>`, `record_access_revoked:<user>`).
- 검증: `test/school-registry.test.js` 기록 권한 3건 + 로컬 PostgreSQL 실제 HTTP(권한 전 403 → 열람만 부여 → 정정 403 → 열람+수정 → 추가·정정·이력·재정정 409 → 학생 본인은 최신만). 운영 DB에는 migration `moakit_accounts_record_access` 적용 완료.

## 진로업체 담당자 계정 + 진로 관찰 기록·활동 사진 (2026-09-14)

기록을 쓰는 사람이 학생·강사만이 아니게 됐다. **모아킷 관리자가 기본을 적고, 수업에 들어간 외부 진로업체 직원이 활동 모습과 사진을 채운다.** 그 직원에게는 학생 기록 말고는 아무것도 보이면 안 된다.

### 진로업체 담당자 역할 `partner`

- `ROLE_LEVEL = { student: 0, partner: 0.5, instructor: 1, admin: 2, superadmin: 3 }` (`lib/auth.js`, `public/app.js`에 같은 값). 강사보다 낮으므로 `minRole: 'instructor'` 이상인 API는 역할 서열만으로 막힌다.
- 서열만으로는 `minRole: 'student'` 경로(수업 자료·시간표·웹앱·게이트 토큰 등)가 열려 버린다. 그래서 디스패처에 **`PARTNER_ALLOW` 화이트리스트**(`lib/api.js`)를 두고 목록 밖 경로는 전부 403. 기록 경로를 새로 만들면 이 목록에도 넣어야 한다 (`test/partner-access.test.js`가 허용·차단 경로를 고정한다)
- 계정 발급은 **관리자 이상만** (`canAssignRole`), 관리는 관리자·슈퍼관리자만 (`canManage`). 화면은 `#/partners`
- **계약·보안 동의 대상에서 제외한다** (`needsAgreement`). 그 계약서는 모아랩 강사용이고, 동의 화면(`/api/agreement`)이 강사 전용이라 걸어 두면 로그인만 되고 아무것도 못 하는 상태가 된다
- 화면에서는 사이드바가 `학생 기록 열람·작성`·`비밀번호 변경` 둘뿐이고, 헤더 전체 검색과 강사용 도움말도 감춘다. 라우터의 `PARTNER_ALLOWED_HASH` 밖으로 나가면 `#/student-records`로 되돌린다
- 볼 수 있는 학교는 기존 `moakit_accounts.record_access` 그대로다 — 관리자가 학교별로 `열람만`/`열람+수정`을 준다. 권한이 없으면 학교 목록이 비어 있다. 계약 여부와 무관하게 중앙에 등록된 학교면 기록을 쌓을 수 있다

### 진로 관찰 기록 `career_observation`

학생이 쓰는 3칸(활동 과정·결과물·돌아보기)과 묻는 것이 다르다. **표의 칸은 그대로 쓰고**(다른 화면과 모아허브가 읽으므로) 무엇을 적은 칸인지는 `raw_data.job.observation`에 남긴다.

| 관찰 항목 | 저장 칸 | 필수 |
|---|---|---|
| `activity` 수업에서 한 활동과 학생의 모습 | `process` | ○ |
| `strengths` 드러난 강점·흥미 | `artifact` | |
| `next_step` 추천하는 다음 활동 | `reflection` | |

- `program_ref='job-career-observation'`, `session_ref='job-school:<학교>'`, `raw_data.job.entry_kind='career_observation'`
- 정정본은 `entry_kind='revision'`이라 원래 종류를 알 수 없다 → `raw_data.job.observation_kind='career_observation'`를 함께 남기고, 읽는 쪽은 `observation` 값 유무까지 함께 본다 (`isObservation`)
- 기존 `job-staff-record`(상담·행정용 일반 담당자 기록)는 그대로 남아 있고 화면에서 골라 쓴다

### 활동 사진

- 표는 **모아랩 쪽 `career_record_photos`** (`lib/db.js` MIGRATIONS, 콜드스타트 때 자동 적용). `career_log.records`는 append-only 라 사진을 거기 넣지 않는다
- **Vercel 은 요청 본문을 4.5MB 에서 자른다**(`server.js` 주석). 그 한도를 넘으면 핸들러까지 오지도 못하므로 장당 상한만으로는 부족하고 **한 요청의 사진 합계**도 막아야 한다. 서버는 JPG·PNG·WEBP / **장당 base64 900,000자(약 660KB)** / **한 요청 합계 3,200,000자(약 2.3MB)** / 한 기록 6장까지 받는다 (`lib/school-registry.js`). 브라우저는 긴 변 1280px·JPEG 0.75로 줄이고, 그래도 크면 품질·크기를 한 단계씩 낮춰 다시 만든다(`public/school-accounts-ui.js`에 같은 값). 3000×2000 노이즈 이미지 6장으로 확인한 실제 요청 본문은 2.18MB
- 기록과 사진은 한 트랜잭션에서 함께 저장된다. 검사(권한·종류·장수)는 **모두 쓰기 전에** 끝낸다
- **사진 바이트는 목록 응답에 실리지 않는다.** 목록에는 `{id, mime, caption}`만 내려가고 실제 이미지는 `GET /api/career-photos/<id>`로만 열린다. 학생 본인은 자기 `student_uuid`의 사진만, 담당자는 `recordLevel`이 있는 학교의 사진만. 응답은 `private, no-store`
- 권한 확인은 `record_id`가 아니라 `student_uuid`·`school_id`로 한다 — 기록이 정정돼도 사진 주인은 그대로다
- **정정하면 사진은 새 버전으로 복사된다.** `keep_photo_ids`로 고른 것만 넘어가고, 빠진 사진도 이전 버전에는 그대로 남는다 (원본 불변)
- 정정도 `addRecord` 와 같은 규칙을 받는다: **진로 관찰 기록이 아니면 사진을 받지 않고**, 장수는 **이어받는 장수 + 새로 넣는 장수**로 센다 (새 사진만 세면 6장을 넘겨 버린다)
- 학생용 경로라 사진도 **학생 접근 시간표**의 적용을 받는다 (`STUDENT_EXEMPT` 밖). 허용 시간 밖에서는 학생 본인도 못 연다
- 정정 없이 저장된 기록에 사진만 더하는 경로(`…/records/<id>/photos`)는 2026-10-02 항목

### 모아허브 쪽 (`teacher-s-project`)

학생 화면(`public/student-accounts.js`)은 `record.artifact`를 제목으로 쓰는데, 진로 관찰 기록의 `artifact`는 "드러난 강점·흥미"라서 그대로 두면 관찰 내용이 제목이 된다. `observationOf()`로 가려내 제목은 `job.title`을 쓰고, 강점·다음 활동은 **선생님이 쓴 내용**으로 이름표를 붙인다(`내가 남긴 생각`이 아니다). 사진은 모아랩에서 본다고 안내한다. (2026-10-02에 '선생님' 문구를 '진로 강사'로 바꾸고 쓴 사람·웹앱 줄을 더했다 — 아래 "표시 문구")

### 아직 없는 것

- **수업 입장 코드로만 참여한 학생**은 대상이 아니다. 담당자 화면은 학교→학생으로 찾는데 코드 학생은 학교 계정이 없고, 기록 번호(`job_identities`)가 기기 쿠키에만 묶여 있어 서버가 학생 행에서 찾아갈 수 없다. 포함하려면 `job_identities`에 게스트 사용자 연결 열을 더하고 담당자↔수업 배정 개념이 필요하다. 2026-10-02의 반 전체 기록도 학교 명단으로 반을 묶으므로 같은 이유로 코드 학생은 나오지 않는다
- 사진은 DB에 base64 로 들어간다. `lib/storage.js`(Supabase Storage)로 옮기는 것은 다음 단계

## 출강 강사 기록 — 웹앱 연결·반 전체 기록·웹앱 격리 (2026-10-02)

수업에 찾아간 진로 강사(모아킷 관리자·진로업체 담당자)가 수업 직후 학생마다 관찰을 남기는 흐름을 다듬었다. 기준 상황은 **학교 와이파이가 자주 끊기고, 공용 아이패드로, 한 반을 한 번에** 쓰는 것이다. 화면은 `#/student-records`(`public/school-accounts-ui.js`), 서버는 `lib/school-registry.js`·`lib/school-registry-api.js`. 학생 기록을 담당자 화면에서 쓰고 읽게 되면서 업로드형 HTML 웹앱도 플랫폼 출처에서 떼어 냈다(아래 "업로드형 HTML 웹앱 격리").

중앙 표(`moakit_accounts`)와 `career_log` 스키마는 바꾸지 않았다. 새 열은 모아랩 `decks.media_access` 하나(`lib/db.js` MIGRATIONS, 콜드스타트 때 자동 적용).

### 웹앱 활동에 잇기 `deck_id`

- 학생이 웹앱에서 남긴 기록(`program_ref='job-deck:<id>'`) 카드에 '이 활동에 관찰 남기기'가 있다(수정 권한이 있을 때). 누르면 그 웹앱·활동 날짜·제목(`<웹앱 이름> 관찰`)이 채워진 진로 관찰 기록 폼이 열린다. 학생별 '기록 추가'에서도 '연결할 웹앱'을 고를 수 있다
- `deck_id`는 **진로 관찰 기록에만** 받는다. 담당자 기록(상담·행정)에 보내면 400
- **아무 웹앱이나 잇는 것은 관리자(admin 이상)만이다.** 강사·진로업체 담당자는 그 학생이 실제로 기록을 남긴 웹앱(그 학생의 `job-deck:<id>` 기록이 있는 것)만 이을 수 있고 아니면 403 — 볼 수 없는 웹앱의 제목이 기록에 실려 새지 않게 한다. 이 확인을 웹앱 조회보다 먼저 해서 없는 번호와 남의 웹앱이 같은 403을 받는다(없는 웹앱 404는 관리자만 본다)
- 화면도 같은 선을 지킨다. 웹앱 목록(`GET /api/decks`)은 관리자일 때만 부른다(진로업체 담당자는 서버에서도 403). 강사·담당자의 선택 칸에는 이 학생이 활동한 웹앱만 나오고, 그런 웹앱이 없으면 칸을 두지 않는다. 관리자 칸은 '이 학생이 활동한 웹앱'/'다른 웹앱'으로 묶고, 목록을 불러오는 중·실패를 칸 아래에 알린다. 실패하면 '웹앱 목록 다시 불러오기'를 누를 때까지 다시 부르지 않는다
- 웹앱 제목은 서버가 `decks`에서 읽어 `raw_data.job.deck_id`·`deck_title`에 넣는다. 요청에 실린 제목은 쓰지 않는다. `program_ref`·`session_ref`는 관찰 기록 그대로(`job-career-observation`, `job-school:<학교>`)라 `observationOf`·`isObservation` 판별이 바뀌지 않는다
- 정정은 `deck_id`를 받지 않는다. 정정본은 원본의 `raw_data.job`을 이어받으므로 연결도 그대로 간다

### 저장은 한 번만 — 담당자 저장의 `attempt_id`

학생 직접 작성(위 "저장 규격")과 같은 방식을 담당자 저장에도 넣었다. 응답만 잃은 저장을 같은 번호로 다시 보내도 기록이 하나만 남는다.

| 저장 | 이벤트 키(`source_event_id`) | 잠금 | 같은 저장으로 보는 조건 | 내용이 다르면 |
|---|---|---|---|---|
| 기록 추가 `POST …/students/<id>/records` | `job-staff:<학생 번호>:<attempt_id>` | 이벤트 키 advisory lock | 종류(`program_ref`)·제목·글 3칸·웹앱(`deck_id`)·날짜·사진 | 409 `code: 'attempt_conflict'` |
| 정정 `POST …/records/<id>/revise` | `job-revision:<원본 id>:<attempt_id>` | 원본 id advisory lock(예전 그대로) | 제목(비우면 원본 제목)·글 3칸·날짜·사진(남긴 것 + 새 것) | '이미 정정된 기록' 409 (`code` 없음) |
| 사진 더하기 `POST …/records/<id>/photos` | 쓰지 않는다 — 사진 내용으로 가린다 | 정정과 같은 잠금 | 이미 붙은 사진과 내용이 같으면 건너뜀 | — |

- `attempt_id`는 UUID다. 화면이 폼을 열 때(반 전체 기록은 학생 줄마다 처음 보낼 때) 만들고 실패 뒤 다시 보낼 때도 그대로 쓴다. 없거나 형식이 틀리면 예전처럼 매번 새 기록이다(`attemptInput`)
- 같으면 새 기록 없이 **200 + `duplicate: true` + 처음 접수번호**. 감사 기록(`moakit_accounts.audit`, 모아랩 접속 기록)도 다시 남기지 않는다. 처음 저장은 예전대로 201
- 사진은 장수·순서·형식·설명·내용까지 본다. DB 쪽은 `md5(data)`로 지문을 만들어 사진 바이트를 내려받지 않고 비교한다. 날짜는 다시 보낸 요청에 있을 때만 비교한다(비워 보냈으면 처음 날짜를 그대로 둔다)
- 다르면 409 — 바뀐 내용을 조용히 버리지 않는다. `code`는 `fail(status, message, code)`가 붙이고 `lib/school-registry-api.js` guard 가 응답에 그대로 싣는다. 화면은 문구가 아니라 이 값으로 가려낸다

화면은 실패를 네 갈래로 나눈다(`classifySaveError`, `public/app.js` `api()`가 던지는 모양에 맞춘다). 기록 추가·정정·사진 더하기 폼과 반 전체 기록이 같은 분류를 쓴다.

| 갈래 | 언제 | 화면 |
|---|---|---|
| rejected | 서버가 4xx 로 거절함(`err.data`가 있다) | '저장 안 됨'. 다시 보낼 때도 같은 시도 번호를 쓴다 |
| conflict | 409 `attempt_conflict` | '이미 저장됨 · 내용이 다름'. 다시 보내지 않고 학생별 보기에서 확인한다 |
| stop | 401(로그인 만료)·403 `time_blocked`·403 `agreement_required` | 저장을 멈추고 이유를 알린다. `api()`가 `state.me`를 비우거나 `state.access`·`state.mustAgree`를 바꾸는 것으로 안다(`state.access`는 요청 직전 값과 비교) |
| unknown | 5xx(시간 초과 포함 — `api()`가 `err.status`를 싣는다)·연결이 끊긴 fetch 의 TypeError 등 | '저장 확인 필요'. 같은 번호로 다시 보내면 한 번만 남는다 |

### 사진 더하기 `POST …/records/<id>/photos`

- 저장된 진로 관찰 기록에 사진만 더한다(`addPhotos`). 기록 본문·버전이 그대로라 정정을 만들지 않고 '정정됨'으로도 표시되지 않는다. `career_record_photos`에만 넣고 `career_log.records`는 건드리지 않는다
- 장당·한 요청 합계·한 기록 6장 규칙은 `addRecord`와 같고, 장수는 **이미 붙은 장수 + 새 장수**로 센다. 화면도 남은 장수만큼만 고르게 한다
- `attempt_id` 대신 사진 내용(md5)으로 다시 보낸 것을 가린다. 이 기록에 이미 있는 사진과 내용이 같으면 설명이 달라도 건너뛴다 — 응답만 잃고 다시 보내도 두 번 붙지 않는다. 일부만 새것이면 새것만 넣고 201(`photos` 넣은 장수, `total` 합계), 모두 이미 있으면 200 `duplicate: true`
- 정정과 같은 advisory lock(`job-record-revise`, 기록 id)을 잡고 이미 정정된 기록이면 409 — 사진이 이전 버전에만 붙는 일을 막는다. 관찰 기록이 아니면 400
- 감사 기록은 `record_photos_added:photos=<n>`(중앙)·`school_record_photos_added`(모아랩)
- 경로가 `/records/` 아래라 `PARTNER_ALLOW`(`…/records(\/|$)`)에 이미 걸린다. `test/partner-access.test.js`가 허용 목록과 서버 경로 등록(`minRole 'partner'`)을 함께 확인한다

### 반 전체 기록

- '반 전체 기록'(수정 권한이 있을 때)으로 한 반 학생 모두의 관찰을 한 화면에서 쓴다. 위에 '기록할 반'·활동 날짜·제목(반 전체에 같은 제목)·공통 활동 내용, 아래에 학생 줄마다 관찰 3칸. 공통 내용은 '빈 칸에 채우기'(적은 칸은 그대로)와 '적은 칸도 바꾸기'(확인을 받는다)로 활동 칸에 넣는다. 이 화면이 열린 동안 학생 찾기용 '학년·반' 칸은 숨긴다
- **새 API 없이** 학생마다 기존 기록 추가 API(`POST …/students/<id>/records`)를 **한 명씩 차례로** 부른다 — `PARTNER_ALLOW`도 그대로다. 요청 본문은 `bulkPayload`(진로 관찰 기록 + 그 줄의 `attempt_id`)
- **시도 번호는 학생 줄마다** 처음 보낼 때 만들어 두고 다시 보낼 때 그대로 쓴다. 한 명이 실패해도 다음 학생으로 넘어가고, stop 이면 거기서 멈춘다. 멈춘 학생과 아직 안 보낸 학생은 빈 상태로 돌아가고(시도 번호는 남는다), 로그인·동의·이용 시간 화면을 다시 덮지 않는다
- 저장 대상은 '수업에서 한 활동과 학생의 모습'을 적은 학생뿐이다. 모든 칸이 빈 학생·이미 서버에 있는 학생·결석·제외 학생은 건너뛴다. 다른 칸만 적고 활동 칸이 빈 학생이 있으면 저장을 시작하지 않고 그 칸으로 안내한다
- **결석·제외**: 줄마다 체크하고 비활성 계정은 처음부터 체크돼 있다. 채우기·저장 모두 건너뛴다. 저장 전에 저장될 학생 수·이름과 제외 수로 확인을 받는다 — 저장한 기록은 지울 수 없고 정정만 된다
- 줄 상태는 '저장 대기' → '저장 중' → '저장됨' / '이미 저장됨'(duplicate) / '저장 안 됨' / '저장 확인 필요' / '이미 저장됨 · 내용이 다름'. 서버에 기록이 있는 줄(저장됨·이미 저장됨·내용이 다름)은 읽기 전용이고 '기록 보기'로 학생별 화면에 간다. '저장 안 됨·확인 필요 학생만 다시 저장'은 rejected·unknown 줄만 다시 보낸다
- **공통 칸 잠금**(`bulkSharedLocked`): 저장됐거나 **저장 확인이 필요한 학생이 한 명이라도 있으면** 제목·날짜·웹앱을 잠근다. 와이파이가 끊겨 모두 '확인 필요'로 끝난 뒤 제목을 고쳐 다시 보내면 실제로 저장된 학생이 모두 409가 되기 때문이다. 확인 필요 학생 각자의 칸은 열어 둔다 — 고치면 그 학생만 '내용이 다름'이 될 수 있고, 그게 실패한 줄을 바로잡는 길이다
- 웹앱 칸은 관리자에게만 보인다(`bulkPayload(…, { linkDeck })`가 관리자일 때만 `deck_id`를 싣는다). 강사·진로업체 담당자는 학생마다 활동한 웹앱이 달라 학생별 화면의 '이 활동에 관찰 남기기'로 잇는다
- **작성 내용은 이 탭의 `sessionStorage`에만** 둔다. 키는 `moalab:student-records:bulk:<계정 id>:<학교 id>`, 모든 접근은 try/catch(사생활 보호 모드에서는 남기지 않을 뿐이다). 아이패드가 메모리가 모자라 탭을 다시 읽어도 남고, 그 학교·그 화면으로 돌아온다. 되살릴 때 '저장 중'이던 줄은 '저장 확인 필요', '저장 대기'였던 줄은 빈 상태로 바꾸고 시도 번호는 그대로 둔다. 공용 기기라 `localStorage`는 쓰지 않는다
- 작성 내용을 지우는 때: 닫기·학교 바꾸기, 저장 뒤 남길 것이 없을 때, 다른 계정이나 수정 권한이 없는 학교로 이 화면을 열 때
- 버리기 전에 확인을 받는다. 적고 저장 못 한 학생이 있으면 닫기·반 바꾸기·학교 바꾸기·탭 닫기(`beforeunload`) 전에, 기록 추가·정정·사진 더하기 폼에 쓴 글이나 고른 사진이 있으면 다른 폼·학생·학교·반 전체 기록을 열기 전에
- 저장을 마치면 요약 줄(`#rs-bulk-summary`, `role=status`)로 초점을 옮기고, 비워 그려 둔 그 줄에 80ms 뒤 글자를 넣어 화면 읽기 프로그램이 읽게 한다
- **사진은 받지 않는다**(요청 본문 4.5MB 한도). 저장한 뒤 학생별 화면의 '사진 더하기'로 넣는다

### 표시 문구 — 진로 강사 관찰, 쓴 사람과 고친 사람

관찰은 학교 선생님이 아니라 수업에 찾아온 진로 강사가 쓴다. 학생이 보는 문구를 그렇게 바꿨다(예전 '담당 선생님 관찰'·'선생님이 본 나의 강점·흥미').

| | 모아랩 내 진로기록 (`public/career-log-ui.js`) | 모아허브 학생 화면 (teacher-s-project `public/student-accounts.js`) |
|---|---|---|
| 종류 | `진로 강사 관찰`, 정정본 `진로 강사 관찰 · 정정` | `… · 모아랩 진로 수업 · 진로 강사 관찰`, 정정본은 끝에 ` · 담당자 정정` |
| 강점 칸 이름표 | `강사가 본 나의 강점·흥미` | 같음 |
| 제목 | `job.title`, 없으면 `진로 관찰 기록` — 웹앱 이름을 제목으로 쓰지 않는다 (`recordHeading`) | 같음 |
| 웹앱 | `웹앱: <deck_title>` (`recordDeckLine`) | 같음 |
| 쓴 사람 | `recordWriter` | `writerOf` |
| 배치 | 쓴 사람·웹앱을 한 줄에 ` · `로 잇는다 | 줄을 나눈다 |

담당자 화면(`#/student-records`)은 종류 `진로 관찰 기록`(정정본은 `정정됨` 배지), 강점 칸 `드러난 강점·흥미`이고, 제목 아래 줄에 수업 이름(제목과 같으면 생략, `recordSession`)·`recordWriter`·`웹앱:`을 잇는다.

- 정정해도 `raw_data.job.author_name`은 **처음 쓴 사람** 그대로다. 고친 사람은 `revised_by`(행위자 `moakit-lab:<id>`)·`revised_by_name`(이름)에 따로 남는다. `revised_by_name`은 늘 값을 둔다(비면 '담당자') — 비어 있으면 화면이 예전 정정본으로 읽는다
- 담당자가 쓴 기록인지는 `program_ref`(`job-career-observation`·`job-staff-record`)로 가린다. 정정본의 `entry_kind`는 늘 `revision`이라 그것으로는 모른다
- 학생이 쓴 기록(학교 수업·웹앱 기록)의 정정본에는 `author_name`을 넣지 않는다 — 학생 글에 담당자 이름이 쓴 사람으로 붙지 않게
- 예전 정정본(`revised_by_name` 없음)은 `author_name`에 고친 사람을 넣었다. 그런 정정본을 다시 정정하면 처음 쓴 사람을 맨 처음 버전에서 다시 읽는다(재귀 질의, 50단계까지)
- 학생 목록 API(`lib/career-log.js`)는 `entry_kind`가 `career_observation`·`staff_record`·`revision`일 때만 `author_name`을, `revision`일 때만 `revised_by_name`을 싣고, `title`과 `deck_title`을 따로 내린다(예전처럼 `deck_title`을 제목 자리에 섞지 않는다). 담당자 목록은 `revised_by_name`·`deck_id`·`deck_title`을 함께 싣는다
- 쓴 사람 줄:
  - 담당자가 쓴 기록 → `작성: A`, 정정됐으면 `작성: A · 정정: B`
  - 학생 글을 담당자가 고친 정정본 → `정정: B`
  - 예전 정정본 → `author_name`을 `정정:`으로 읽는다(학생들이 지금까지 보던 그대로)
- **모아랩과 모아허브가 같은 규칙이다. 한쪽 문구·규칙을 바꾸면 다른 쪽도 맞춘다** (`test/career-log.test.js`, 모아허브 `tests/student-account-ui.test.mjs`). 다른 것은 한 줄/여러 줄 배치뿐이다

### 업로드형 HTML 웹앱 격리

강사가 올린 HTML 웹앱(`decks.kind='html'`)은 플랫폼과 같은 주소 `/api/webapp/<id>`에서 나간다. 예전에는 `allow-same-origin`이 든 sandbox iframe 의 `src`로 열어 플랫폼과 같은 출처로 돌았고, 그러면 앱 코드가 보는 사람의 로그인 쿠키로 진로기록·학생 기록·관리자 API 를 부를 수 있다. 지금은 **불투명 출처(`origin: null`)에서만** 돈다. 코드는 `lib/webapp-sandbox.js`·`public/app.js` `mountWebappFrame`.

- **플랫폼 화면**: 부모가 `fetch('/api/webapp/<id>')`로 HTML 을 받아 `sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"` iframe 의 `srcdoc`으로 넣는다. `src`로 넣지 않는 이유 — 불투명 출처 문서가 다시 읽힐 때(새로고침 등)는 SameSite=Strict 세션 쿠키가 실리지 않아 401 이 난다
- **주소로 바로 열 때**: 응답 헤더 `Content-Security-Policy: sandbox <같은 토큰>`이 같은 격리를 건다. 함께 `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`(`webappHeaders`)
- **`allow-same-origin`을 다시 넣지 않는다.** `test/webapp-sandbox.test.js`가 `public/app.js` 코드(주석 제외)에 그 토큰이 없는지, `/api/webapp`을 `src`로 여는 iframe 이 없는지 본다
- **보조 스크립트**(`injectSandboxShim`): 서버가 HTML 의 첫 스크립트로 넣는다. `<!doctype>` 뒤(앞에 넣으면 쿼크 모드), `<head>`가 있으면 그 첫머리, 없으면 `<html>` 바로 뒤이고 BOM·앞선 주석은 건너뛴다. ES5 로만 쓰고 예외를 밖으로 내지 않는다. 불투명 출처에서 막히는 것을 대신한다
  - `localStorage`·`sessionStorage`: 메모리 저장소(속성 접근·`Object.keys`도 된다). 쓸 때마다 `window.name`(`moalab-storage:` 표식 + JSON, 웹앱 번호가 맞을 때만 이어받는다)에 남겨 앱 안 새로고침에도 이어지고, 바뀐 쪽을 부모에 `postMessage`로 보낸다
  - `document.cookie`: 막혔을 때만 빈 값
  - `reportApiUsage(n)`: 부모를 거쳐 `/api/usage/report`로 간다(2초씩 묶고, 화면을 떠날 때 남은 것을 보낸다)
- **부모 쪽 보관**: localStorage 몫은 부모 localStorage `moalab:webapp:<사용자 id>:<웹앱 id>`에 JSON 1,000,000자까지(넘으면 버리고 직전 값을 둔다). sessionStorage 몫은 부모 페이지 메모리(`WEBAPP_SESSIONS`)에만 둔다 — 플랫폼이 5분마다(`refreshMe`) 화면을 다시 그려 iframe 을 새로 만들어도 이어지고, 다른 사용자가 웹앱을 열면 앞 사용자 몫을 지운다. 새 iframe 에는 둘을 `name`으로 넘기고, `name`은 문서에 붙이기 전에 정한다(크롬은 붙인 뒤 바꾼 `name`을 안으로 넘기지 않는다). 부모는 **그 iframe(`e.source`)에서 온, 그 웹앱 번호의** 메시지만 받는다
- **연결 떼기**: 다른 화면으로 가면(`hashchange`) 떼고 모아 둔 사용량을 보낸다. `pagehide`에서는 보내기만 하고 계속 듣는다(뒤로/앞으로 캐시에서 페이지가 돌아와도 이어지게). iframe 이 빠졌으면 다음 메시지·`pagehide` 때 뗀다
- **기준 주소 `<base href="about:srcdoc">`는 srcdoc 끝에 붙인다**(`WEBAPP_SRCDOC_BASE`). srcdoc 문서는 부모 주소(`/class#/view/…`)를 기준으로 써서 `href="#sec2"`·`"#"`가 iframe 을 플랫폼 화면으로 바꿔 버린다. 끝에 두는 이유: 읽어 들이는 동안의 주소(앞쪽 `//cdn…` 스크립트 등)는 예전 기준으로 풀리고, 앱이 자기 `<base href>`를 두었으면 그것이 앞이라 그대로 쓰인다. 서버 응답(직접 열기)에는 넣지 않는다 — 그때는 문서 주소가 `/api/webapp/<id>`라 `#` 이동이 원래 제자리다
- **iframe `allow`**: 업로드형은 `fullscreen; clipboard-write; autoplay`(`WEBAPP_ALLOW`). 카메라·마이크는 불투명 출처라 위임해도 `getUserMedia`가 SecurityError 라서 넣지 않는다
- **새 창**: 앱이 연 새 창(외부 링크·`target=_blank`)은 `allow-popups-to-escape-sandbox`로 샌드박스를 벗는다 — 없으면 유튜브·커리어넷 같은 외부 사이트도 불투명 출처가 돼 저장소·로그인이 깨진다. 새 창에서 `/api/webapp/<id>`를 열어도 CSP sandbox 가 다시 걸린다
- **`/api/assets/<id>`는 `text/html` 자산에 404**: 웹앱 HTML 도 `assets`에 있어 그 경로로 열면 샌드박스 없이 같은 출처로 돈다. DB 에서 직접 내주는 자산 응답(200·206·416)에는 `nosniff`를 붙인다
- **두 곳이 같아야 한다**: `WEBAPP_SANDBOX`, 저장 표식, `WEBAPP_ALLOW`·`LINK_ALLOW`·`LINK_ALLOW_MEDIA`가 `lib/webapp-sandbox.js`와 `public/app.js`에 따로 있다(빌드 단계가 없어 같은 모듈을 쓸 수 없다). `test/webapp-sandbox.test.js`가 두 파일의 값을 맞춰 본다

### 외부 배포 웹앱의 카메라·마이크 — 자료별로 켠다

- 카메라·마이크가 필요한 웹앱은 HTML 업로드로는 동작하지 않는다. 웹에 배포한 뒤 '외부 배포 웹앱'(`kind='link'`)으로 등록하고 '링크 설정'(새로 만들 때는 만들기 창)에서 '카메라·마이크 사용'을 켠다. HTML 업로드 칸에 그렇게 안내한다
- `decks.media_access BOOLEAN NOT NULL DEFAULT false`. 외부 링크 자료에만, 값이 정확히 `true`일 때만 켜진다(문자열 `"true"`는 끔). HTML 자료에는 무시한다
- 바꿀 수 있는 사람은 자료 수정 권한(`canEditDeck` — 자료 주인 또는 관리자 이상)과 같다. 켜고 끈 것은 접속 기록에 `media_access=on/off`로 남는다(`deck_created`·`deck_updated`)
- 켠 자료의 뷰어 iframe 에만 `LINK_ALLOW_MEDIA`(`…; camera; microphone`)를 주고, 학생 화면에 '이 웹앱은 카메라·마이크 사용을 요청할 수 있습니다'를 붙인다. 자료 응답에는 `mediaAccess`(외부 링크만 true 가 될 수 있다)
- **왜 자료별인가**: 크롬은 iframe 의 권한 요청을 플랫폼 이름으로 띄우고, 학생이 이 플랫폼에 한 번 준 카메라·마이크 허용을 위임받은 iframe 과 함께 쓴다. 모든 외부 링크에 위임하면 아무 강사 링크나 묻지 않고 그 허용을 다시 쓸 수 있다
- 외부 링크의 기본 `allow`(`LINK_ALLOW`)는 업로드형과 같은 `fullscreen; clipboard-write; autoplay`다

### 검증

- 테스트: `test/school-registry.test.js`(정정의 쓴 사람·학생 글 정정본·예전 정정본 사슬·담당자 목록의 `revised_by_name`·담당자 기록 + 웹앱 400·관리자만 아무 웹앱·존재 여부 안 샘·409 `code`), `test/career-log.test.js`(`revised_by_name`·`recordWriter`·`recordSession`), `test/student-records-bulk.test.js`·`student-records-bulk-exclude.test.js`·`student-records-bulk-save.test.js`(`app.js`의 실제 `api()`로 400·401·이용 시간·동의·409·502·연결 끊김 분류, 다시 보낼 대상, 공통 칸 잠금, 작성 내용 보관·되살리기), `test/partner-access.test.js`(사진 경로), `test/webapp-sandbox.test.js`, `test/deck-media-access.test.js`(실제 `lib/api.js` 핸들러 + 가짜 DB), `test/ui-layout.test.js`. 모아허브 `tests/student-account-ui.test.mjs`에 정정본 3건
- 로컬 PostgreSQL 16 에 `career_log`와 재현한 `moakit_accounts`를 올리고 실제 서버를 HTTP 로 확인: API 59건(웹앱 연결 권한·`attempt_id` 중복과 충돌·사진 더하기·정정의 쓴 사람·`media_access`·업로드 웹앱 응답 헤더·`/api/assets` HTML 404), 동시 요청 4건(같은 정정 4번 → 1건, 같은 사진 3번 → 1장, 학생 본인 저장 3번 → 1건), 모아허브 서비스·화면 코드와 교차 5건(모아랩에서 바꾼 비밀번호로 로그인, 최신 버전만, `작성: 김진로 · 정정: 이강사`·`웹앱:` 줄), 헤드리스 크롬 실제 클릭 53건(업로드 앱 `origin: null`·쿠키 빈 값·플랫폼 API 호출 막힘·저장소는 부모가 보관)
- 크롬 141(권한 요청 자동 수락)에서 업로드형 앱의 클립보드 쓰기와 학생이 플랫폼에서 누른 뒤의 소리 자동재생이 되고, 카메라는 `allow`를 줘도 SecurityError, 외부 링크는 `media_access`를 켠 것만 카메라·마이크가 열리는 것을 확인했다
- 운영 DB·실제 학교 계정으로는 아직 확인하지 않았다

### 아직 없는 것·알려진 제약

- **업로드형 HTML 웹앱**: 카메라·마이크와 IndexedDB 는 안 된다. 저장소는 앱·사용자당 JSON 1,000,000자까지이고 플랫폼 출처의 localStorage 전체 한도를 다른 앱과 함께 쓴다. sessionStorage 는 플랫폼 페이지가 열려 있는 동안만 이어진다. `location`은 `about:srcdoc`이다(직접 열면 `/api/webapp/<id>`)
- 위 기준 주소 때문에 **읽기를 마친 뒤 만드는 상대 주소**(`fetch('data.json')`, 나중에 붙이는 `//cdn…` 스크립트, `img/a.png`)는 about:srcdoc 기준이라 풀리지 않는다. 외부 파일은 `https://` 전체 주소로 쓴다
- 앱의 localStorage 몫(`moalab:webapp:<사용자>:<웹앱>`)은 로그아웃해도 그 브라우저에 남는다. 키에 사용자 번호가 있어 다른 사용자의 앱 화면에는 실리지 않는다
- 5분마다 `refreshMe` → `navigate()`가 뷰어를 다시 그려 iframe 을 새로 만든다. 저장소는 이어지지만 앱이 JS 메모리에만 둔 상태(게임 진행·쓰던 글)는 사라지고, 외부 링크 iframe 도 새 게이트 토큰으로 다시 읽힌다. 바뀐 것이 없으면 `#/view/*`를 다시 그리지 않게 하면 둘 다 풀린다
- 로컬 서버(`server.js`)는 `/class`를 `Cache-Control: no-store`로 내보내 크롬 141 이 뒤로/앞으로 캐시에서 되살리지 않는다 — 위 `pagehide` 처리는 그런 페이지를 캐시하는 브라우저에서만 쓰인다. Vercel 정적 응답의 헤더로는 확인하지 않았다
- 반 전체 기록 작성 내용(sessionStorage `moalab:student-records:bulk:*`)과 웹앱 sessionStorage 몫(`WEBAPP_SESSIONS`)은 로그아웃할 때 지운다(`public/app.js` 로그아웃 버튼). 공용 기기에서 다음 사람이 같은 탭으로 들어와도 앞 사람 초안이 남지 않는다
- 반 전체 기록에서 사진을 넣는 길은 없다(학생별 '사진 더하기'로 한 명씩). 강사·진로업체 담당자는 반 전체 기록에서 웹앱을 잇지 못하고, 정정으로 웹앱 연결을 바꿀 수도 없다
- 날짜만 고른 담당자 기록은 그날 0시 UTC 로 저장돼 화면에 오전 9:00 으로 보인다(예전부터 그렇다)
