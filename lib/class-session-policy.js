'use strict';

// 수업(입장 코드) 세션을 계속 살려둘지 판단하는 규칙 — DB 없이 단독으로 검증 가능하게 분리했다.
//
// 배경: 만료 시각은 "혹시 몰라 걸어둔 안전장치"지, 수업이 길어졌다고 학생을 작업 중에
// 끊으라는 뜻이 아니다. 예전에는 만료 시각이 지나는 순간 학생이 그대로 튕겼다.
// 이제는 학생이 실제로 쓰고 있는 동안에만 만료를 미루고(방치된 코드는 원래대로 만료),
// 총 수명 상한을 둬서 코드가 영원히 살아있지 않게 한다.

const CLASS_EXTEND_MINUTES = 60;      // 한 번에 늘려주는 시간
const CLASS_RENEW_BELOW_MINUTES = 15; // 남은 시간이 이보다 적을 때부터 연장
const CLASS_GRACE_MINUTES = 30;       // 만료 직후 유예 (쉬는 시간에 잠깐 손 뗀 학생 구제)
const CLASS_MAX_HOURS = 12;           // 개설 시각 기준 총 수명 상한

const MIN = 60 * 1000;

/**
 * @param {{active: boolean, expires_at: string|Date, created_at: string|Date}|null} cs
 * @param {number} now 밀리초 타임스탬프
 * @returns {{action: 'ok'} | {action: 'extend', until: Date} | {action: 'end', message: string}}
 */
function classSessionState(cs, now = Date.now()) {
  if (!cs) return { action: 'end', message: '수업 정보를 찾을 수 없습니다. 새 입장 코드로 다시 접속하세요.' };
  // 선생님이 직접 종료한 수업은 유예 없이 즉시 끊는다.
  if (!cs.active) return { action: 'end', message: '선생님이 수업을 종료했습니다. 새 입장 코드로 다시 접속하세요.' };

  const expiresAt = new Date(cs.expires_at).getTime();
  const hardLimit = new Date(cs.created_at).getTime() + CLASS_MAX_HOURS * 60 * MIN;
  if (!Number.isFinite(expiresAt) || !Number.isFinite(hardLimit)) {
    return { action: 'end', message: '수업 정보를 확인할 수 없습니다. 새 입장 코드로 다시 접속하세요.' };
  }

  // 아직 여유가 있으면 그대로 통과 (불필요한 DB 쓰기 방지)
  if (expiresAt - now > CLASS_RENEW_BELOW_MINUTES * MIN) return { action: 'ok' };

  // 유예 시간까지 지났으면 진짜 종료
  if (now > expiresAt + CLASS_GRACE_MINUTES * MIN) {
    return { action: 'end', message: '수업 시간이 끝났습니다. 새 입장 코드로 다시 접속하세요.' };
  }
  // 총 수명 상한을 넘겼으면 더 늘리지 않는다
  if (now > hardLimit) {
    return { action: 'end', message: '수업 코드의 사용 기한이 끝났습니다. 새 입장 코드로 다시 접속하세요.' };
  }

  // 학생이 실제로 쓰고 있으므로 연장한다 (상한을 넘지 않는 선에서)
  const target = Math.min(now + CLASS_EXTEND_MINUTES * MIN, hardLimit);
  if (target <= expiresAt) return { action: 'ok' }; // 이미 그만큼 늘어나 있음
  return { action: 'extend', until: new Date(target) };
}

module.exports = {
  classSessionState,
  CLASS_EXTEND_MINUTES, CLASS_RENEW_BELOW_MINUTES, CLASS_GRACE_MINUTES, CLASS_MAX_HOURS,
};
