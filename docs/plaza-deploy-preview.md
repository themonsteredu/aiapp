# 광장 코드 미리보기 배포 — 2026-10-04

- 저장소: `themonsteredu/aiapp`
- 기준: 5단계 `70fb6a083ac17804b664abe5041cd64d4835f3bd`
- 배포 브랜치: `deploy/plaza-preview-20261004`
- 대상: 기존 Vercel `aiapp` 프로젝트의 Preview
- 목적: 온라인 DB 연결에 앞서 현재 코드를 배포하고 접속 주소를 제공한다.

## 사용 범위

`/`는 기존 랜딩, `/class`는 접속 시 `/plaza-preview.html`의 배포 안내로 이동한다.
광장 배경과 정적 파일은 배포되며 로그인·수업·기록 저장은 비활성이다.
실제 학생 자료, 계정, DB 스키마는 조회하거나 변경하지 않는다.

`vercel.json`의 비밀이 아닌 `MOALAB_DEPLOY_ONLY=1` 설정은 서버의 두 진입점 모두에서 DB API의 import 자체를 막는다.
상속된 `DATABASE_URL`이 있어도 연결하지 않는다.
`GET /api/deployment-status`만 상태를 반환하고, 나머지 API는 503과 `deployment_preview` 코드를 반환한다.

온라인 수업 활성화에는 격리된 DB·파일 저장소 및 온라인용 광장 설정을 별도 구현하고 검증해야 한다.
이 브랜치를 현재 상태 그대로 운영에 병합하거나 승격하지 않는다.
0단계 설계와 기존 로컬 시험용 광장 플래그는 변경하지 않았다.

## 확인

`npm run check`, `npm test`로 구문·회귀를 확인한다.
배포용 회귀는 두 서버 진입점의 DB API 미로딩, 조회·저장 차단, 상태 응답, 정적 파일 제공을 검증한다.
배포 후 Vercel READY, 안내 페이지, 상태 API, 차단된 `/api/me`를 확인한다.
