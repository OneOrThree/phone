// groupDeck:v1의 프로세스 세션 fallback 상태. 영속 저장 실패는 다음 앱 실행에서만 재노출하고,
// 완료 key 읽기 실패는 현재 세션에서 한 번만 안내를 시도한다.
let completed = false;
let unknownAttemptReserved = false;

export function isGroupDeckGuideCompletedInSession(): boolean {
  return completed;
}

export function markGroupDeckGuideCompletedInSession(): void {
  completed = true;
}

export function reserveUnknownGroupDeckGuideAttempt(): boolean {
  if (unknownAttemptReserved) return false;
  unknownAttemptReserved = true;
  return true;
}

export function resetGroupDeckGuideSessionForTests(): void {
  completed = false;
  unknownAttemptReserved = false;
}
