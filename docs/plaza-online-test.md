# 광장 온라인 시험 — 2026-10-05

브랜치: `feat/plaza-online-test-20261005` (5단계 `70fb6a0`에서 시작)
대상: Vercel `aiapp` 프로젝트의 **이 브랜치 Preview 하나**와 Supabase 시험 프로젝트 `aiapp-plaza-test`(`yxnenjtmuvdlfxnwxecp`, 조직 `girls102`, 서울)
목적: 4·5단계의 로컬 시험을 실제 인터넷 주소에서 가짜 참여자로 다시 해 보기. 실제 학생·운영 배포가 아니다.

`plaza-plan.md`의 규칙은 그대로다. 운영 DB(`vypnobpmyadtcvxhtagn`)와 기존 미디어 버킷은 쓰지 않는다. `lib/db.js` 자동 적용 목록에 광장 표를 넣지 않는다. main·운영 브랜치에 합치지 않는다. 실제 키트가 확인되지 않았으므로 가짜 키트 카드로만 진행한다.

## 어떻게 켜지고 어떻게 멈추나

`PLAZA_ONLINE_TEST=1`이면 `lib/plaza-online.js`가 서버 입구(`server.js`, `api/index.js`)에서 `lib/api.js`·`lib/db.js`를 읽기 **전에** 아래를 모두 확인한다. 하나라도 어긋나면 DB에 연결하지 않고, 모든 API가 503을 낸다. `GET /api/deployment-status`만 어긋난 항목의 코드(예: `database_url_missing`)를 알려 준다.

| 확인 | 내용 |
|---|---|
| 배포 | Vercel Preview(`VERCEL_ENV=preview`)이고 브랜치가 정확히 이 브랜치. 운영 배포에서는 이 설정을 무시하고 평소대로 돈다 |
| DB 주소 | `DATABASE_URL`은 읽지 않는다(지금 Preview가 운영과 같은 값을 물려받기 때문). `PLAZA_ONLINE_DATABASE_URL`만 쓰고, Supabase 서울 풀러(포트 6543, DB `postgres`)이면서 사용자 이름 끝이 시험 프로젝트 번호여야 한다. 운영 프로젝트 번호가 어디든 들어 있으면 거절한다. `?host=` 같은 덧붙임 값과 `PGHOST` 등 다른 연결 변수도 거절한다 |
| 기타 | 광장 1~5단계 설정, 가짜 키트(`PLAZA_SYNTHETIC_KIT=1`), 시험 번호(`PLAZA_TEST_ID`), 12자 이상이고 기본값이 아닌 `SUPERADMIN_PASSWORD`. 파일 사진 폴더·기존 동영상 저장소 설정이 있으면 거절 |

통과하면 DB 안의 시험 표식(`plaza_environment`: 목적 `online-test`, 시험 프로젝트 번호, 시험 번호)을 광장 요청마다 다시 확인한다. 운영 DB에는 이 표식이 없으므로 광장이 열리지 않는다. 설치 SQL(`db/plaza-stage*.sql`, `db/plaza-online-storage.sql`)도 Supabase에서는 시험 프로젝트 번호를 요구하고, 운영 DB에만 있는 `moakit_accounts`·`moalab` 스키마가 보이면 설치를 거부한다.

## 사진과 삭제 목록

Vercel에는 계속 남는 디스크가 없어서 사진을 시험 DB의 비공개 표(`plaza_photo_blobs`)에 둔다. 삭제 목록(`plaza_purge_ledger`)도 같은 DB에 있다. `lib/plaza-storage.js`의 `pgTestStorage`는 파일 저장소와 같은 약속을 지킨다.

- 서버가 다시 읽어 확인한 뒤에만 "저장됨"이 된다
- 같은 촬영 번호에 다른 사진은 409, 파기한 사진은 410이다. 사진 원본은 고칠 수 없다
- 파기는 지운 뒤 다시 조회해 없음을 확인한다. 삭제 목록은 늘어나기만 한다

광장 거래 안에서는 그 연결을 그대로 쓴다. 연결이 하나뿐인 Vercel에서도 서로 기다리다 멈추지 않는다. 저장소 호출마다 savepoint를 두어서, 한 장을 지우다 실패해도 파기 작업 전체가 취소되지 않고 "재시도"로 남는다.

**파일 방식과 다른 점.** 파일 방식의 삭제 목록은 DB 백업과 따로 있어서 DB를 되돌려도 남았다. 온라인 시험에서는 삭제 목록도 DB 안에 있다. 그래서 **시험 DB를 백업에서 되돌리면 그 DB는 버리고 학생에게 다시 열지 않는다.** 지운 사진은 Supabase 백업·기록에 보관 기간 동안 남을 수 있다. 파기 결과의 `whole_system_complete`는 계속 false다.

## 시험 DB 준비 (한 번)

`node scripts/plaza-online-schema.js <PLAZA_TEST_ID> <폴더>`가 설치 SQL 9개를 만든다. DB에 연결하지는 않는다. 시험 프로젝트에 프로젝트 주인(`postgres`)으로 번호 순서대로 적용한다.

1. 공개 키 역할(anon·authenticated, 그리고 PUBLIC)의 public 스키마 사용과 기본 권한 회수
2. 앱 표 — `lib/db.js` 초기화의 DDL을 그대로 옮긴 것. 슈퍼관리자 등 기본 데이터는 앱이 첫 요청 때 넣는다
3. 가짜 진로기록 스키마(`db/plaza-test-career-log.sql`, 원본 수정 금지 트리거 포함)와 `db/job-career-log.sql`
4. 광장 1~4단계 SQL, DB 사진 저장소 SQL(시험 번호·시험 프로젝트 번호를 설정한 뒤)
5. 모든 표 RLS 켜기, 공개 키 역할의 모든 표·시퀀스·함수 권한 회수

앱은 표 주인으로 접속하므로 RLS 정책 없이도 읽고 쓴다. Supabase 공개 키로는 어떤 표도 열리지 않는다.

## 운영자가 하는 일

비밀값은 대화나 저장소에 남기지 않도록 운영자가 직접 넣는다.

1. Supabase 시험 프로젝트에서 DB 비밀번호를 새로 만들고, **Connect → Transaction pooler** 주소에 넣는다
2. Vercel `aiapp` → Settings → Environment Variables에 **Preview, 이 브랜치 전용**으로 두 값을 넣는다(Sensitive)
   - `PLAZA_ONLINE_DATABASE_URL` — 위 주소
   - `SUPERADMIN_PASSWORD` — 시험 관리자 첫 비밀번호(12자 이상). 첫 로그인에서 바꾸라고 나온다
3. 다시 배포한다. 나머지 비밀이 아닌 설정(`PLAZA_ONLINE_TEST`, 단계 설정, 가짜 키트, 시험 번호)은 같은 범위에 이미 넣어 두었다

## 시험 진행 (5단계 runbook과 같은 화면)

시험 관리자로 로그인 → 강사·관리자 계정 만들기 → 수업 자료 만들기·공개 → 수업 코드 만들기·자료 배정 → 광장 프로그램 카드(가짜 키트) 등록 → 광장 준비 → 관리자가 시험 보관 기간 등록 → 학생 기기에서 수업 코드로 입장. 시험 배포 주소는 로그인 없이 누구나 열 수 있다. 수업 코드와 계정을 시험 참여자에게만 알린다.

## 검증

- `npm run check`, `npm test` (온라인 판정 시험 `test/plaza-online.test.js` 포함 174개)
- 로컬 PostgreSQL 16, 단계마다 새 DB에서 1~5단계 검증을 **파일 저장소와 DB 저장소 모두** 실행: 1단계 54 / 2단계 215 / 3단계 90 / 4단계 85·86 / 5단계 62개 통과. DB 저장소는 Vercel과 같은 연결 1개(`PG_POOL_MAX=1`)로도 모두 통과
- 온라인 흉내 시험. Supabase처럼 SSL만 받는 6543 포트와 `postgres.<시험 프로젝트 번호>` 사용자를 두고, 슈퍼유저가 아닌 표 주인 역할로 설치 SQL 9개를 적용한다. Vercel Preview와 같은 환경값과 운영처럼 보이는 가짜 `DATABASE_URL`을 둔 채 `scripts/plaza-online-verify.js` 18개와 5단계 검증 62개를 통과했다. 사진 저장·열람·철회 파기·진로기록·QR 주소·공개 키 차단을 포함한다
- 실제 시험 배포 주소에서는 상태 응답과 화면 접속만 확인한다. 실제 iPad 카메라·인쇄·QR 스캔은 운영자가 직접 해 본다

## 남은 위험

- 앱은 새 서버 인스턴스가 뜰 때마다 `lib/db.js` 초기화 DDL을 다시 실행한다. 수업 중 새 인스턴스가 뜨면 잠깐 표 잠금이 겹쳐 요청 하나가 실패할 수 있다(DB가 교착을 풀고, 다시 보내면 된다)
- 화면은 3초마다 상태를 다시 읽는다. 시험은 기기 수를 적게 시작한다
- AI는 연결하지 않았다. 준비된 예시로 진행하고 기록에 예시라고 남는다
- 무료 Supabase 프로젝트는 일주일 동안 쓰지 않으면 잠든다. 시험 전에 깨워 둔다

## 정리

시험이 끝나면 Vercel의 이 브랜치 전용 값 두 개를 지우고, Supabase `aiapp-plaza-test` 프로젝트를 삭제한다. 운영 DB와 운영 사이트는 이 시험과 연결되지 않는다.
