'use strict';
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { hashPassword } = require('./password');

// Supabase(또는 임의 Postgres) 연결 문자열.
// Vercel 서버리스에서는 Supabase의 Transaction Pooler 주소(포트 6543)를 권장.
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다. (예: Supabase 대시보드 → Connect → Transaction pooler URI)');
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 1 : 5)),
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function q(sql, params = []) {
  const r = await pool.query(sql, params);
  return r.rows;
}
async function one(sql, params = []) {
  return (await q(sql, params))[0] || null;
}

// 표시용 시간대 (감사 로그·생성일이 이 시간대 문자열로 반환됨)
const TZ = /^[A-Za-z_/+-]{1,60}$/.test(process.env.APP_TIMEZONE || '') ? process.env.APP_TIMEZONE : 'Asia/Seoul';
// SQL 조각: timestamptz → 'YYYY-MM-DD HH:MM:SS' (KST) 텍스트
const TS = (col) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI:SS')`;
// SQL 조각: 해당 시간대 기준 오늘 0시 (timestamptz)
const KST_TODAY = `(date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('superadmin','admin','instructor','student')),
  class_name TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '', -- 과목(폴더) 분류
  published BOOLEAN NOT NULL DEFAULT false,
  created_by INT NOT NULL,
  target_classes TEXT NOT NULL DEFAULT '',
  access_start TEXT NOT NULL DEFAULT '',
  access_end TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slides (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  bg TEXT NOT NULL DEFAULT 'theme-navy',
  align TEXT NOT NULL DEFAULT 'left'
);

CREATE TABLE IF NOT EXISTS schedules (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  deck_id INT REFERENCES decks(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT,
  ua TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 슬라이드 이미지 자산 (PPT 변환 업로드, base64 저장)
CREATE TABLE IF NOT EXISTS assets (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id INT REFERENCES decks(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 1회성 수업 세션 (입장 코드)
CREATE TABLE IF NOT EXISTS class_sessions (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  deck_id INT REFERENCES decks(id) ON DELETE SET NULL, -- NULL = 공개 중인 모든 웹앱
  created_by INT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 수업에 담긴 자료 목록 (여러 웹앱/PPT/동영상을 한 수업에 묶고, 학생 공개·잠금을 개별 제어)
CREATE TABLE IF NOT EXISTS session_items (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id INT NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  student_visible BOOLEAN NOT NULL DEFAULT true,  -- 학생 목록에 노출 (false = 강사 전용)
  unlocked BOOLEAN NOT NULL DEFAULT true,         -- 지금 학생이 열 수 있는가 (false = 잠금)
  UNIQUE (session_id, deck_id)
);

CREATE INDEX IF NOT EXISTS idx_slides_deck ON slides(deck_id, position);
CREATE INDEX IF NOT EXISTS idx_logs_time ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_session_items ON session_items(session_id, position);
`;

// 기존 배포 DB 마이그레이션: 게스트(1회성) 학생 계정이 속한 수업 세션
const MIGRATIONS = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS guest_session_id INT;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT '';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'slides';       -- 'slides' | 'link'(외부 웹앱)
ALTER TABLE decks ADD COLUMN IF NOT EXISTS external_url TEXT NOT NULL DEFAULT '';
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS live_deck_id INT;                 -- 라이브 발표 중인 덱 (NULL = 라이브 아님)
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS live_slide INT NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';            -- 배경 라이브러리 표시 이름
ALTER TABLE assets ADD COLUMN IF NOT EXISTS created_by INT;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS is_bg BOOLEAN NOT NULL DEFAULT false;     -- 슬라이드 배경용 여부
ALTER TABLE class_sessions ADD COLUMN IF NOT EXISTS instructor_id INT;                -- 담당 강사 (관리자가 배정)
ALTER TABLE assets ADD COLUMN IF NOT EXISTS storage_path TEXT;                        -- Supabase Storage 경로 (있으면 data 대신 사용)
ALTER TABLE assets ALTER COLUMN data DROP NOT NULL;                                   -- 스토리지 자산은 data가 비어 있음
-- 삭제 승인 워크플로우 (본인이 요청 → 슈퍼관리자 승인)
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_pending BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_requested_by INT;
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ;
-- 계약·보안 동의
ALTER TABLE users ADD COLUMN IF NOT EXISTS agreed_version INT NOT NULL DEFAULT 0;
-- 요금 유형 (무료 / API 유료) — 종량 과금·분류용
ALTER TABLE decks ADD COLUMN IF NOT EXISTS cost_type TEXT NOT NULL DEFAULT 'free';    -- 'free' | 'api_paid'
ALTER TABLE decks ADD COLUMN IF NOT EXISTS api_provider TEXT NOT NULL DEFAULT '';     -- 예: OpenAI, Anthropic
ALTER TABLE decks ADD COLUMN IF NOT EXISTS unit_cost INT NOT NULL DEFAULT 0;          -- 1인·1회당 예상 원가(원)
`;

// 과정(패키지) — 수업의뢰 단위로 자료를 묶고 강사에게 배정하는 상위 개념
const COURSES_TABLE = `
CREATE TABLE IF NOT EXISTS courses (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 과정에 담긴 자료 (필수/선택 플래그가 여기 붙는다 — 같은 자료도 과정마다 다를 수 있음)
CREATE TABLE IF NOT EXISTS course_items (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  required BOOLEAN NOT NULL DEFAULT true,   -- true=필수(강제), false=선택(강사가 담기)
  position INT NOT NULL DEFAULT 0,
  UNIQUE (course_id, deck_id)
);
-- 강사배정: 어떤 강사가 어떤 과정을 맡는가
CREATE TABLE IF NOT EXISTS course_instructors (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, instructor_id)
);
-- 강사가 담은 선택 자료 (required=false 자료 중 강사가 쓰겠다고 선택한 것)
CREATE TABLE IF NOT EXISTS course_opt_ins (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  instructor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deck_id INT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  opted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, instructor_id, deck_id)
);
`;

// 종량 과금 계측: API 유료 자료 열람/호출을 수업·강사 단위로 귀속해 적재
const USAGE_TABLE = `
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  deck_id INT NOT NULL,
  user_id INT,
  is_guest BOOLEAN NOT NULL DEFAULT false,
  session_id INT,                         -- 수업(class_sessions).id — 게스트 사용이면 채워짐
  instructor_id INT,                      -- 귀속 강사 (수업 담당자 또는 자료 소유자)
  calls INT NOT NULL DEFAULT 1,           -- 이 이벤트가 나타내는 호출 수 (열람은 1)
  kind TEXT NOT NULL DEFAULT 'open',      -- 'open'(열람) | 'api_call'(실제 API 호출)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 기존 배포 DB 마이그레이션
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS session_id INT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS instructor_id INT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS calls INT NOT NULL DEFAULT 1;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'open';
CREATE INDEX IF NOT EXISTS idx_usage_deck_time ON usage_events(deck_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_instructor ON usage_events(instructor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events(session_id);
`;

// 정산: 월·프로바이더별 실제 청구액 입력값 (측정된 호출 비율로 배분)
const SETTLEMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS settlements (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period TEXT NOT NULL,                    -- 정산 월 'YYYY-MM'
  provider TEXT NOT NULL DEFAULT '',       -- API 제공자 (빈값 = 미지정 버킷)
  invoice_amount BIGINT NOT NULL DEFAULT 0,-- 실제 청구 금액(원)
  note TEXT NOT NULL DEFAULT '',
  confirmed BOOLEAN NOT NULL DEFAULT false, -- 정산 확정 여부
  created_by INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period, provider)
);
`;

// 계약·동의 기록
const AGREEMENTS_TABLE = `
CREATE TABLE IF NOT EXISTS agreements (
  id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INT NOT NULL,
  version INT NOT NULL,
  signed_name TEXT NOT NULL,
  ip TEXT,
  agreed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// 기본 계약·보안 동의 문서
const DEFAULT_AGREEMENT = `AI 온라인 교육 플랫폼 이용·비밀유지 및 정산 계약서

본 계약서(이하 "본 계약")는 AI 온라인 교육 플랫폼(이하 "플랫폼")을 운영하는 회사(이하 "회사")와 플랫폼을 이용하는 관리자·강사(이하 "이용자") 사이에 플랫폼 이용, 콘텐츠 보호, 비밀유지, 개인정보 보호 및 비용 정산에 관한 권리·의무를 정함을 목적으로 체결됩니다.

━━ 제1장 총칙 ━━

제1조(목적) 본 계약은 회사가 제공하는 플랫폼 및 관련 서비스의 이용조건·절차와 회사·이용자의 권리·의무 및 책임사항을 규정함을 목적으로 한다.

제2조(정의) 본 계약에서 사용하는 용어의 뜻은 다음과 같다.
1. "플랫폼"이란 회사가 운영하는, PPT·동영상·웹앱 등 수업 콘텐츠를 관리·발표하고 요일·시간 기반으로 학생 접근을 통제하는 온라인 교육 관리 서비스를 말한다.
2. "이용자"란 회사로부터 계정을 부여받아 플랫폼을 이용하는 관리자 및 강사를 말한다.
3. "관리자"란 슈퍼관리자로부터 임명되어 강사·학생 관리, 웹앱 배정, 접속기록·리포트 열람 등의 권한을 부여받은 이용자를 말한다.
4. "강사"란 수업 운영(웹앱 제작·발표) 및 담당 학생 관리 권한을 가진 이용자를 말한다.
5. "학생"이란 허용된 시간에 배정된 수업 콘텐츠를 이용하는 최종 이용자를 말한다.
6. "콘텐츠"란 플랫폼에 게시·제공되는 PPT·이미지·동영상·웹앱 및 그 부속 자료 일체를 말한다.
7. "API 유료 자료"란 이용 시 외부 제공자(OpenAI 등)에게 실비가 발생하는 것으로 지정된 콘텐츠를 말한다.
8. "사용량"이란 플랫폼이 측정·집계하는 API 호출 수, 이용 학생 수 등 정산의 기초가 되는 데이터를 말한다.
9. "개인정보"란 학생의 성명·소속 등 개인을 식별할 수 있는 정보를 말한다.

제3조(계약의 구성 및 우선순위) ① 본 계약은 회사가 플랫폼 내에 게시하는 이용정책·보안정책·정산기준 등 세부 지침을 그 일부로 포함한다. ② 본 계약과 개별 서면 약정의 내용이 상충하는 경우에는 개별 서면 약정이 우선한다.

제4조(계약의 성립 및 효력) ① 이용자가 플랫폼 내에서 전자적 방식으로 본 계약에 동의함으로써 본 계약이 성립하며, 전자적 동의는 서면 서명과 동일한 효력을 가진다. ② 회사가 계약 내용을 개정하고 재동의를 요구하는 경우, 이용자는 계속 이용을 위하여 개정 내용에 동의하여야 한다. 동의 이력(성명·시각·IP)은 기록·보관된다.

━━ 제2장 계정과 이용자의 지위 ━━

제5조(권한 체계) ① 플랫폼의 권한은 슈퍼관리자–관리자–강사–학생의 4단계로 구성된다. ② 계정의 생성·부여는 항상 자신보다 낮은 권한에 대해서만 가능하며, 관리자 계정의 생성·임명·권한 변경은 슈퍼관리자의 전용 권한이다. ③ 이용자는 부여받은 권한 범위를 벗어난 기능을 이용하거나 이를 시도하지 아니한다.

제6조(계정 관리 및 보안) ① 이용자는 본인 계정을 타인과 공유·양도·대여하지 아니한다. ② 이용자는 비밀번호 및 2단계 인증(TOTP) 정보를 안전하게 관리하며, 계정 도용·유출이 의심되는 경우 즉시 회사에 통지한다. ③ 계정 관리 소홀로 발생한 손해에 대한 책임은 이용자에게 있다.

━━ 제3장 서비스 이용 ━━

제7조(서비스 이용범위) ① 이용자는 본 계약과 회사의 정책에 따라 수업 목적 범위 내에서 플랫폼을 이용한다. ② 회사는 서비스 개선을 위하여 기능을 추가·변경할 수 있으며, 중대한 변경 시 사전에 통지한다.

제8조(접근 통제의 준수) 이용자는 요일·시간 기반 접근 통제, 수업 입장 코드, 라이브 발표 등 회사가 제공하는 접근 통제 기능의 취지를 준수하며, 이를 우회하거나 무력화하지 아니한다.

제9조(콘텐츠의 권리 및 보호) ① 플랫폼 및 콘텐츠에 관한 저작권 등 일체의 지식재산권은 회사 또는 정당한 권리자에게 귀속한다. ② 이용자는 콘텐츠를 수업 목적으로만 이용하며, 회사의 사전 서면 동의 없이 이를 복제·배포·전송·출판하거나 2차적저작물을 작성하지 아니한다. ③ 이용자는 콘텐츠를 캡처·녹화·인쇄 등의 방법으로 무단 반출하지 아니하며, 회사의 캡처 방지·워터마크·접속기록 등 보호조치를 훼손하지 아니한다. ④ 이용자가 플랫폼에 업로드한 자료에 대하여 이용자는 적법한 권리를 보유함을 보증하며, 회사는 서비스 제공에 필요한 범위에서 이를 이용할 수 있다.

━━ 제4장 비밀유지와 개인정보 ━━

제10조(비밀유지) ① 이용자는 업무상 알게 된 회사의 기술·운영·영업 정보, 학생 개인정보, 수업 자료, 접속 기록 등 일체의 비밀정보를 제3자에게 누설하거나 업무 외 목적으로 사용하지 아니한다. ② 다음 각 호는 비밀정보에서 제외한다. 1. 공지된 사실, 2. 이용자가 정당하게 이미 보유한 정보, 3. 법령·법원·감독기관의 적법한 요구에 따라 공개하는 정보(이 경우 지체 없이 회사에 통지한다). ③ 본 조의 의무는 계약 종료 후에도 3년간 존속한다.

제11조(개인정보의 보호) ① 이용자는 개인정보 보호법 등 관계 법령을 준수하며, 학생 개인정보를 수업 목적 범위 내에서만 처리한다. ② 이용자는 개인정보를 제3자에게 제공하거나 목적 외로 이용하지 아니하며, 수업 종료 또는 보유목적 달성 시 지체 없이 파기한다. ③ 개인정보의 분실·도난·유출 사고가 발생하거나 발생할 우려가 있는 경우, 이용자는 지체 없이 회사에 통지하고 피해 최소화를 위한 회사의 조치에 협조한다.

━━ 제5장 비용과 정산 ━━

제12조(요금 유형) 콘텐츠는 이용 시 외부 실비가 발생하지 아니하는 "무료 자료"와, 외부 제공자에게 실비가 발생하는 "API 유료 자료"로 구분되며, 각 자료의 요금 유형은 플랫폼에 표시된다.

제13조(비용 부담의 원칙) ① API 유료 자료의 이용에 따라 외부 제공자에게 발생하는 실비는 이용자가 부담한다(pass-through). 회사는 원칙적으로 실비에 별도의 이윤을 부가하지 아니하고 이를 그대로 배분·청구한다. ② 본 계약에 따른 모든 금액은 부가가치세가 포함되지 아니한 금액이며, 부가가치세는 이용자가 별도로 부담한다.

제14조(사용량의 측정) ① 회사는 API 호출량을 수업(입장 코드 차시)·담당 강사·자료 단위로 귀속하여 측정한다. ② 사용량 보고 기능이 적용된 자료는 실제 호출 수를 기준으로, 미적용 자료는 열람 1회를 1회 호출로 추정하여 집계한다. ③ 이용자는 플랫폼이 기록한 사용량 집계를 정산의 근거 자료로 인정한다.

제15조(정산 방식) ① 회사는 매월 외부 제공자의 실제 청구액을 기준으로 정산한다. ② 각 이용자·수업·자료에 대한 배분액은 측정된 호출 비율에 따라 산정하며, 그 계산식은 [배분액 = 실청구액 × 대상 호출수 ÷ 해당 제공자 전체 호출수]로 한다. ③ 배분 총액은 제공자 청구액과 일치하며, 반올림에 따른 잔여는 최다 사용 대상에 귀속한다.

제16조(통지·납부 및 이의) ① 회사는 매월 익월 5영업일 이내에 이용자에게 배분 내역을 통지한다. ② 이용자는 통지일로부터 14일 이내에 해당 금액을 납부한다. ③ 이용자가 배분 내역에 이의가 있는 경우 통지일로부터 7일 이내에 회사에 서면으로 이의를 제기할 수 있으며, 회사는 사용량 기록을 근거로 이를 검토·조정한다.

제17조(미납의 효과) 이용자가 납부기한까지 정산금을 납부하지 아니하는 경우, 회사는 미납액에 대하여 연 12%의 지연손해금을 청구할 수 있으며, 7일 이상의 기간을 정하여 최고한 후에도 납부가 없는 경우 서비스 이용을 정지할 수 있다.

━━ 제6장 의무와 책임 ━━

제18조(관리자의 감독 책임) 관리자는 자신이 관리하는 강사·학생이 본 계약 및 회사의 정책을 준수하도록 지도·감독할 의무를 지며, 감독 의무를 다하지 못한 범위(고의 또는 중대한 과실을 포함한다)에서 발생한 위반에 대하여 책임을 진다.

제19조(금지행위) 이용자는 다음 각 호의 행위를 하여서는 아니 된다. 1. 콘텐츠의 무단 복제·배포·반출, 2. 접근 통제 및 보안조치의 우회·무력화, 3. 계정의 공유·양도·대여, 4. 타인의 권리 침해 또는 법령 위반, 5. 플랫폼의 정상적 운영을 방해하는 행위, 6. 그 밖에 본 계약 및 회사 정책에 위반되는 행위.

제20조(손해배상 및 책임의 제한) ① 일방이 본 계약을 위반하여 상대방에게 손해를 입힌 경우, 위반 당사자는 그로 인한 직접적·통상적 손해를 배상한다. ② 회사와 이용자 각각의 배상책임 총액은 손해 발생일을 기준으로 직전 12개월간 이용자가 회사에 지급한 이용료(정산금) 합계를 한도로 한다. ③ 다만 다음 각 호의 경우에는 제2항의 한도를 적용하지 아니한다. 1. 고의 또는 중대한 과실, 2. 제10조(비밀유지)·제11조(개인정보) 위반, 3. 제3자의 지식재산권 침해. ④ 회사는 이용자의 귀책사유로 인한 손해 및 이용자가 업로드한 자료에 관한 분쟁에 대하여는 책임을 지지 아니한다.

제21조(면책) 이용자의 본 계약 위반, 콘텐츠의 무단 이용, 또는 이용자가 업로드한 자료로 인하여 제3자가 회사에 대하여 청구·소송을 제기하는 경우, 이용자는 자신의 비용과 책임으로 회사를 면책시키고 회사에 발생한 손해를 배상한다.

━━ 제7장 계약기간과 해지 ━━

제22조(계약기간 및 갱신) 본 계약의 기간은 최초 동의일로부터 1년으로 하며, 기간 만료 30일 전까지 어느 당사자도 서면(전자적 방식을 포함한다)으로 갱신 거절의 의사를 표시하지 아니하는 경우 동일한 조건으로 1년씩 자동 갱신된다.

제23조(해지) ① 각 당사자는 30일 전 서면 통지로써 본 계약을 해지할 수 있다. ② 일방이 본 계약을 중대하게 위반하거나 정산금을 기한 내에 납부하지 아니하는 경우, 상대방은 14일 이상의 기간을 정하여 그 시정을 최고하고, 그 기간 내에 시정되지 아니하면 계약을 즉시 해지할 수 있다.

제24조(계약 종료의 효과) ① 계약이 종료된 경우 이용자의 플랫폼 이용 권한은 소멸한다. ② 회사는 관계 법령상 보존 의무가 있는 경우를 제외하고 이용자의 계정 및 관련 데이터를 종료일로부터 30일 이내에 처리·파기한다. ③ 종료일까지 발생한 미정산 금액은 종료일을 기준으로 정산·청산하며, 정산·비밀유지·손해배상에 관한 조항은 계약 종료 후에도 그 성질상 존속하여야 하는 범위에서 유효하다.

━━ 제8장 일반조항 ━━

제25조(불가항력) 천재지변, 전쟁, 정전, 통신 장애, 외부 서비스 제공자(클라우드·API 등)의 장애 등 당사자의 합리적 통제를 벗어난 사유로 인한 의무의 불이행에 대하여는 책임을 지지 아니한다. 다만 이미 발생한 금전 지급 의무는 면제되지 아니한다.

제26조(권리·의무의 양도) 이용자는 회사의 사전 서면 동의 없이 본 계약상의 지위 또는 권리·의무의 전부나 일부를 제3자에게 양도·이전하거나 담보로 제공하지 아니한다.

제27조(통지) 본 계약에 따른 통지는 서면, 전자우편 또는 플랫폼 내 알림으로 하며, 상대방에게 도달한 때(전자적 통지의 경우 발송한 때)에 효력이 발생한다. 이용자는 연락처가 변경되는 경우 지체 없이 회사에 알린다.

제28조(일반) ① 본 계약의 일부 조항이 무효 또는 집행 불능으로 판단되더라도 나머지 조항의 효력에는 영향을 미치지 아니한다. ② 어느 당사자가 본 계약상의 권리를 행사하지 아니하거나 그 행사를 지체하는 것은 그 권리의 포기로 간주되지 아니한다. ③ 본 계약은 그 대상에 관한 당사자 간의 완전한 합의이며, 이전의 구두·서면 합의에 우선한다.

제29조(준거법 및 관할) 본 계약은 대한민국 법에 따라 규율·해석되며, 본 계약과 관련하여 발생하는 분쟁에 대하여는 회사의 본점 소재지를 관할하는 법원을 제1심 관할 법원으로 한다.

부칙
본 계약은 이용자가 전자적 방식으로 동의한 날부터 시행한다.`;

async function init() {
  await pool.query(SCHEMA);
  await pool.query(MIGRATIONS);
  await pool.query(AGREEMENTS_TABLE);
  await pool.query(COURSES_TABLE);
  await pool.query(USAGE_TABLE);
  await pool.query(SETTLEMENTS_TABLE);

  // 슈퍼관리자 시드
  const su = await one("SELECT count(*)::int AS c FROM users WHERE role = 'superadmin'");
  if (su.c === 0) {
    const initialPw = process.env.SUPERADMIN_PASSWORD || 'ChangeMe123!';
    await q(
      "INSERT INTO users (username, password_hash, name, role, must_change_password) VALUES ($1, $2, $3, 'superadmin', true)",
      ['superadmin', hashPassword(initialPw), '슈퍼관리자']
    );
    console.log('최초 실행: 슈퍼관리자 계정 생성 — superadmin /', process.env.SUPERADMIN_PASSWORD ? '(SUPERADMIN_PASSWORD 값)' : 'ChangeMe123!');
  }
  // 기본 접근 시간(월~금 09~18시) 시드
  const sc = await one('SELECT count(*)::int AS c FROM schedules');
  if (sc.c === 0) {
    for (const dow of [1, 2, 3, 4, 5]) {
      await q("INSERT INTO schedules (day_of_week, start_time, end_time) VALUES ($1, '09:00', '18:00')", [dow]);
    }
  }
  // 보안 설정 기본값
  const defaults = {
    block_capture: '1', block_copy: '1', block_rightclick: '1', watermark: '1',
    devtools_detect: '1', single_session: '0', ip_restrict: '0', two_factor: '0',
    ip_allowlist: '',
    // 워터마크 표시 설정: 내용 템플릿({이름}/{아이디}/{시각}), 배치, 진하기
    wm_text: '{이름} ({아이디}) {시각}',
    wm_position: 'tile',
    wm_opacity: 'medium',
    // 계약·보안 동의
    agreement_text: DEFAULT_AGREEMENT,
    agreement_version: '1',
    agreement_required: '1', // 강사·관리자 최초 이용 시 동의 요구
  };
  for (const [k, v] of Object.entries(defaults)) {
    await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
  }
  // 외부 웹앱 게이트 토큰 서명용 비밀키 (최초 1회 생성, 클라이언트에 노출 금지)
  await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
    ['gate_secret', crypto.randomBytes(24).toString('hex')]);
}

// 서버리스: 인스턴스(콜드 스타트)당 1회만 초기화
let readyPromise = null;
function ready() {
  readyPromise ||= init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

const STRING_SETTING_KEYS = new Set(['ip_allowlist', 'gate_secret', 'wm_text', 'wm_position', 'wm_opacity', 'agreement_text', 'agreement_version']);

async function getSettings() {
  const out = {};
  for (const row of await q('SELECT key, value FROM settings')) {
    out[row.key] = STRING_SETTING_KEYS.has(row.key) ? row.value : row.value === '1';
  }
  return out;
}

async function setSetting(key, value) {
  const stored = STRING_SETTING_KEYS.has(key) ? String(value ?? '') : (value ? '1' : '0');
  await q('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, stored]);
}

// req가 주어지면 접속 IP와 브라우저 정보를 함께 기록한다.
async function log(user, action, detail = '', req = null) {
  let ip = null;
  let ua = null;
  if (req) {
    ip = clientIp(req);
    ua = String(req.headers['user-agent'] || '').slice(0, 200);
  }
  await q(
    'INSERT INTO audit_logs (user_id, username, action, detail, ip, ua) VALUES ($1, $2, $3, $4, $5, $6)',
    [user ? user.id : null, user ? user.username : null, action, String(detail).slice(0, 500), ip, ua]
  );
}

function clientIp(req) {
  // Vercel 등 신뢰 가능한 프록시 뒤에서는 X-Forwarded-For의 첫 항목을 사용
  if (process.env.TRUST_PROXY === '1' || process.env.VERCEL) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

module.exports = { q, one, ready, log, getSettings, setSetting, clientIp, TS, KST_TODAY, DEFAULT_AGREEMENT };
