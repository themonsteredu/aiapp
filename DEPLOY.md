# 배포 가이드

이 앱은 **Supabase(Postgres)에 데이터를 저장**하고, 앱 서버는 어디에나 올릴 수 있는 구조입니다.
데이터가 외부 DB에 있으므로 Vercel 같은 서버리스 호스팅에도 올릴 수 있고, **전부 무료**로 운영 가능합니다.

## 0단계 — Supabase 프로젝트 만들기 (공통, 5분)

1. https://supabase.com 가입 → **New project** (리전: Seoul `ap-northeast-2` 권장)
2. 프로젝트 생성 시 정한 **Database Password**를 기억해 두세요
3. 대시보드 상단 **Connect** 버튼 → **Transaction pooler** 탭의 URI 복사
   - `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres` 형태
   - `[YOUR-PASSWORD]` 부분을 실제 비밀번호로 바꾼 것이 `DATABASE_URL` 값입니다
4. 테이블은 만들 필요 없습니다 — 앱이 첫 실행 때 스키마와 초기 계정을 자동 생성합니다

### 공통 환경변수

| 환경변수 | 값 | 설명 |
|---|---|---|
| `DATABASE_URL` | 위 URI | Supabase 연결 문자열 (필수) |
| `SUPERADMIN_PASSWORD` | 원하는 값 | 초기 슈퍼관리자 비밀번호 (미설정 시 `ChangeMe123!`) |
| `TRUST_PROXY` | `1` | 프록시 뒤에서 실제 접속 IP 인식 (Vercel은 자동) |
| `COOKIE_SECURE` | `1` | HTTPS 세션 쿠키 보호 (Vercel은 자동) |
| `SUPABASE_URL` | `https://xxx.supabase.co` | (선택) 대용량 동영상 업로드용 — 아래 참고 |
| `SUPABASE_SERVICE_KEY` | service_role 키 | (선택) 위와 함께 설정 |

### (선택) 대용량 동영상 업로드 — Supabase Storage

동영상 파일을 슬라이드에 올릴 때, 이 두 변수를 설정하면 **최대 200MB** 파일을 브라우저가 Supabase에 직접 업로드합니다(서버·Vercel 4.5MB 제한 우회). 미설정 시에는 25MB 이하 파일만 DB에 저장하는 방식으로 동작합니다.

1. Supabase 대시보드 → **Project Settings → API** 에서 `Project URL`(= `SUPABASE_URL`)과 **`service_role` 키**(= `SUPABASE_SERVICE_KEY`) 복사
   - ⚠️ `service_role` 키는 관리자 권한 키입니다. **서버 환경변수로만** 넣고 절대 클라이언트/저장소에 노출하지 마세요 (이 앱은 서버에서만 사용).
2. 두 변수를 배포 환경변수에 추가
3. 첫 동영상 업로드 시 `media` 버킷(비공개)이 자동 생성됩니다. (수동 생성도 가능: Storage → New bucket → 이름 `media`, Public 해제)
4. 재생은 로그인·시간표·잠금 규칙 통과 후 단기 서명 URL로만 제공되어, 주소가 유출돼도 곧 만료됩니다.

무료 티어 Storage 용량은 1GB입니다. 그보다 긴/많은 영상은 유튜브(일부공개)를 병행하세요.

---

## 방법 1. Vercel — 무료, 추천

저장소에 `vercel.json`과 `api/index.js`가 포함되어 있어 바로 올라갑니다.

1. https://vercel.com 가입 → **Add New → Project** → 이 GitHub 저장소 Import
2. 배포 브랜치 선택, Framework Preset은 **Other** 그대로
3. **Environment Variables**에 `DATABASE_URL`, `SUPERADMIN_PASSWORD` 입력 → **Deploy**
4. 1~2분 뒤 `https://<프로젝트명>.vercel.app` 주소 발급 — 끝

- 비용: Hobby 플랜 무료 (개인/소규모 교육용 충분)
- 서울 리전(`icn1`)으로 함수가 실행되도록 설정해 두었습니다 (Supabase도 서울이면 최적)
- 이후 GitHub에 푸시할 때마다 자동 재배포, 데이터는 Supabase에 안전하게 유지

## 방법 2. Render.com — 무료

DB가 외부에 있으므로 이제 **무료 플랜으로도 데이터가 보존**됩니다.

1. https://render.com 가입 → **New → Blueprint** → 저장소 연결
2. `render.yaml` 자동 인식 → `DATABASE_URL`, `SUPERADMIN_PASSWORD` 입력 → Apply

단점: 무료 플랜은 15분 미사용 시 잠들고, 다음 접속 시 깨어나는 데 30초~1분 걸립니다.
(데이터는 Supabase에 있으므로 유실되지 않습니다. 수업 시작 전에 한 번 접속해 깨워두면 됩니다.)

## 방법 3. Fly.io / VPS / 학교 서버

`Dockerfile`이 포함되어 있어 컨테이너로 어디서든 실행 가능합니다.

```bash
# Fly.io
fly launch --no-deploy
fly secrets set DATABASE_URL='...' SUPERADMIN_PASSWORD='...'
fly deploy

# 일반 서버 (Node 22+)
git clone <저장소> && cd aiapp && npm install --omit=dev
DATABASE_URL='...' PORT=3000 node --no-warnings server.js
```

VPS에서의 systemd/nginx HTTPS 구성은 이전과 동일하며, `Environment=`에 `DATABASE_URL`만 추가하면 됩니다.

---

## 배포 후 확인 사항

1. 발급된 주소로 접속 → `superadmin` + 설정한 비밀번호로 로그인 (첫 로그인 시 변경 강제)
2. **시간표 접근 설정**을 실제 수업 시간으로 조정 (기본: 월~금 09~18시, Asia/Seoul)
3. **보안 설정**에서 필요한 항목 켜기 (IP 제한은 학교 공인 IP 대역 입력 후 활성화)
4. 관리자/강사/학생 계정 생성 및 웹앱 배정
5. 백업: Supabase 대시보드 → Database → Backups (무료 플랜도 7일 자동 백업 제공)

## 참고

- Supabase 무료 프로젝트는 **1주일간 요청이 전혀 없으면 일시정지**됩니다. 학기 중 사용에는 문제없고, 방학 등 장기 미사용 후에는 Supabase 대시보드에서 Resume 버튼 한 번이면 복구됩니다.
- 무료 한도: DB 500MB — 텍스트 슬라이드 기준으로 사실상 제한 없이 사용 가능한 수준입니다.
