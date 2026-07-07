# 배포 가이드

이 앱은 **상시 실행되는 Node.js 서버 + SQLite 파일 DB** 구조입니다.
따라서 서버가 계속 떠 있고 디스크가 보존되는 호스팅이 필요합니다.

> ⚠️ **Vercel/Netlify 같은 서버리스 호스팅은 맞지 않습니다.**
> 요청마다 인스턴스가 생겼다 사라지는 구조라 SQLite 데이터와 로그인 세션이 유지되지 않습니다.

## 공통 준비

1. GitHub 저장소의 배포용 브랜치를 정합니다. (`main`에 머지하거나, 현재 개발 브랜치를 그대로 지정해도 됩니다)
2. 배포 시 환경변수 3~4개만 설정하면 됩니다.

| 환경변수 | 값 | 설명 |
|---|---|---|
| `DATA_DIR` | `/var/data` 등 | SQLite 저장 위치 (영구 디스크 마운트 경로) |
| `TRUST_PROXY` | `1` | 프록시 뒤에서 실제 접속 IP 인식 (IP 제한 기능용) |
| `COOKIE_SECURE` | `1` | HTTPS 환경에서 세션 쿠키 보호 |
| `SUPERADMIN_PASSWORD` | 원하는 값 | 최초 슈퍼관리자 비밀번호 (미설정 시 `ChangeMe123!`) |

---

## 방법 1. Render.com — 가장 쉬움 (추천)

저장소에 `render.yaml` 블루프린트가 포함되어 있어 클릭 몇 번으로 끝납니다.

1. https://render.com 가입 → **New → Blueprint**
2. 이 GitHub 저장소 연결 → 배포 브랜치 선택
3. `render.yaml`이 자동 인식됨 → `SUPERADMIN_PASSWORD` 값만 입력 → **Apply**
4. 몇 분 뒤 `https://career-edu-webapp.onrender.com` 형태의 HTTPS 주소가 발급됩니다.

- 비용: 영구 디스크가 필요하므로 **Starter 플랜(월 $7)** 권장.
  무료 플랜은 잠들었다 깨어나는 지연 + 재배포 시 데이터 초기화가 있어 수업용으로 부적합합니다.
- 이후 GitHub에 푸시할 때마다 자동 재배포됩니다.

## 방법 2. Fly.io — 저렴하고 한국에서 빠름 (도쿄 리전)

저장소에 `Dockerfile`과 `fly.toml`이 포함되어 있습니다.

```bash
# 1) CLI 설치 및 로그인
curl -L https://fly.io/install.sh | sh
fly auth signup   # 또는 fly auth login

# 2) 저장소 클론 후 앱 생성 (fly.toml 자동 인식, 앱 이름만 바꾸면 됨)
git clone <저장소 주소> && cd aiapp
fly launch --no-deploy          # 기존 fly.toml 사용 선택
fly volumes create appdata --size 1 --region nrt
fly secrets set SUPERADMIN_PASSWORD='원하는비밀번호'

# 3) 배포
fly deploy
```

`https://<앱이름>.fly.dev` HTTPS 주소가 발급됩니다. 소규모 사용은 월 $2~5 수준입니다.

## 방법 3. Railway.app

1. https://railway.app 가입 → **New Project → Deploy from GitHub repo**
2. 저장소 선택 → Settings → **Volumes**에서 볼륨 추가 (Mount path: `/data`)
3. Variables에 `DATA_DIR=/data`, `TRUST_PROXY=1`, `COOKIE_SECURE=1`, `SUPERADMIN_PASSWORD=...` 입력
4. Settings → Networking → **Generate Domain** 으로 공개 주소 발급

## 방법 4. 학교/기관 서버 또는 VPS (완전한 통제가 필요할 때)

Ubuntu 기준:

```bash
# Node.js 22 설치
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# 앱 배치
sudo git clone <저장소 주소> /opt/aiapp
sudo mkdir -p /var/lib/aiapp

# systemd 서비스 등록
sudo tee /etc/systemd/system/aiapp.service > /dev/null <<'UNIT'
[Unit]
Description=Career Edu Webapp
After=network.target

[Service]
WorkingDirectory=/opt/aiapp
Environment=PORT=3000 DATA_DIR=/var/lib/aiapp TRUST_PROXY=1 COOKIE_SECURE=1
ExecStart=/usr/bin/node --no-warnings server.js
Restart=always

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now aiapp
```

HTTPS는 nginx + certbot(Let's Encrypt)으로:

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo tee /etc/nginx/sites-available/aiapp > /dev/null <<'NGINX'
server {
  server_name 도메인.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Host $host;
  }
}
NGINX
sudo ln -s /etc/nginx/sites-available/aiapp /etc/nginx/sites-enabled/
sudo certbot --nginx -d 도메인.example.com
```

---

## 무료로 운영하기

완전 무료 옵션은 세 가지이며, 각각 감수할 점이 다릅니다.

### A. Oracle Cloud Always Free — 진짜 무료 + 데이터 보존 (운영용으로도 가능)

평생 무료 VM(Ampere ARM 4코어/24GB 또는 AMD 1GB)을 제공합니다. 가입 시 카드 인증이 필요하지만 무료 한도 내에서는 과금되지 않습니다.

1. https://cloud.oracle.com 가입 (Always Free)
2. Ubuntu VM 인스턴스 생성 → 네트워크 보안 목록에서 80/443 포트 개방
3. 위 **방법 4(VPS)** 절차를 그대로 실행

무료 옵션 중 유일하게 "잠들지 않고 + 데이터가 보존되는" 방식이라 실제 수업 운영까지 가능합니다.

### B. Render 무료 플랜 — 5분 만에 올라가지만 시연용

무료 웹 서비스로 배포는 되지만 두 가지 제약이 있습니다.

- 15분간 접속이 없으면 잠들고, 다음 접속 시 깨어나는 데 30초~1분 걸림
- **영구 디스크가 없어 재배포/재시작 시 DB(계정·자료·로그)가 초기화됨**

→ 데모·시연·단기 테스트용으로는 충분하고, 실제 수업 운영에는 부적합합니다.
사용하려면 `render.yaml`의 `plan: starter`를 `plan: free`로 바꾸고 `disk:` 블록 3줄을 삭제한 뒤 배포하세요.

### C. 항상 켜진 PC + Cloudflare Tunnel — 기존 장비 활용

학교나 집에 항상 켜져 있는 PC가 있다면 추가 비용 없이 외부 공개가 가능합니다.

```bash
# PC에서 앱 실행
npm start

# Cloudflare 빠른 터널로 공개 HTTPS 주소 발급 (무료, 계정 불필요)
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ 에서 cloudflared 설치 후:
cloudflared tunnel --url http://localhost:3000
```

실행하면 `https://무작위이름.trycloudflare.com` 주소가 발급됩니다.
빠른 터널은 재시작할 때마다 주소가 바뀌므로, 고정 주소가 필요하면 무료 Cloudflare 계정 + 보유 도메인으로 이름 있는 터널을 만들면 됩니다.

| | 비용 | 데이터 보존 | 잠들지 않음 | 난이도 |
|---|---|---|---|---|
| Oracle Always Free | 무료 | ✅ | ✅ | 중 (VPS 설정) |
| Render 무료 | 무료 | ❌ | ❌ | 하 |
| PC + Cloudflare Tunnel | 무료 | ✅ (PC에 저장) | PC가 켜져 있는 동안 | 하 |
| Render Starter | 월 $7 | ✅ | ✅ | 하 |

---

## 배포 후 확인 사항

1. 발급된 주소로 접속 → `superadmin` + 설정한 비밀번호로 로그인 (첫 로그인 시 변경 강제)
2. **시간표 접근 설정**에서 실제 수업 시간으로 조정 (기본: 월~금 09~18시)
3. **보안 설정**에서 필요한 항목 켜기 (IP 제한은 학교 공인 IP 대역 입력 후 활성화)
4. 관리자/강사/학생 계정 생성 및 웹앱 배정
5. 백업: `DATA_DIR`의 `app.db` 파일 하나만 주기적으로 복사하면 됩니다.
