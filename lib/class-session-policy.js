'use strict';

// 수업(입장 코드) 세션이 아직 유효한지 판단하는 규칙 — DB 없이 단독으로 검증 가능하게 분리했다.
//
// 정책: **종료 시간이 되면 무조건 끊는다.** 유예도, 자동 연장도 없다.
// 수업을 더 진행해야 하면 선생님이 새 입장 코드를 발급한다.
// (연장·유예를 넣으면 선생님이 정한 종료 시각이 의미를 잃는다.)
//
// 끊는 시점 자체는 예전과 같고, 학생에게 보여줄 사유만 구분해서 돌려준다.

/**
 * @param {{active: boolean, expires_at: string|Date}|null} cs
 * @param {number} now 밀리초 타임스탬프
 * @returns {{action: 'ok'} | {action: 'end', message: string}}
 */
function classSessionState(cs, now = Date.now()) {
  if (!cs) return { action: 'end', message: '수업 정보를 찾을 수 없습니다. 새 입장 코드로 다시 접속하세요.' };
  // 선생님이 직접 종료한 경우
  if (!cs.active) return { action: 'end', message: '선생님이 수업을 종료했습니다. 새 입장 코드로 다시 접속하세요.' };

  const expiresAt = new Date(cs.expires_at).getTime();
  if (!Number.isFinite(expiresAt)) {
    return { action: 'end', message: '수업 정보를 확인할 수 없습니다. 새 입장 코드로 다시 접속하세요.' };
  }
  // 종료 시각이 지났으면 그대로 끊는다
  if (now >= expiresAt) {
    return { action: 'end', message: '수업 시간이 끝났습니다. 새 입장 코드로 다시 접속하세요.' };
  }
  return { action: 'ok' };
}

module.exports = { classSessionState };
