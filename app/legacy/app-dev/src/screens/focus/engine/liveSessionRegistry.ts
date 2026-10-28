// 「이 프로세스에서 실제로 돌고 있는 세션」 등록부 (GROMO-1600, codex 리뷰 #694 10차).
//
// 고아 정산은 진행 중인 세션을 건드리면 안 된다 — 5초 주기 저장 전이면 커밋 흔적을 지우고,
// 그 뒤엔 진행 중인 블록을 조기 적립·업로드한다. 그런데 판정 근거로 **저널의 active**를
// 쓰면 정반대 사고가 난다: 강제 종료된 세션도 저널엔 `active`로 남아 있어(복구는 `starting`만
// 손댄다), 다음 콜드 스타트의 고아 정산이 영원히 건너뛴다. 그 상태로 새 집중을 시작하면
// 이전 세션의 v1이 덮여 종료 전 집중 시간이 통째로 사라진다.
//
// 그래서 판정은 **메모리**로 한다. 프로세스가 죽으면 이 등록부도 함께 사라지므로, 다음
// 기동에서는 「돌고 있지 않다」가 되어 고아 정산이 정상적으로 회수한다.
let liveSessionKey: string | null = null;

/** 엔진이 세션을 시작할 때 — 이 프로세스가 그 세션을 돌리고 있다고 표시한다. */
export function markSessionLive(sessionKey: string): void {
  liveSessionKey = sessionKey;
}

/** finish·이탈에서 해제. 이미 다른 세션이 등록됐으면 건드리지 않는다(늦은 정리 방지). */
export function clearSessionLive(sessionKey: string): void {
  if (liveSessionKey === sessionKey) liveSessionKey = null;
}

/** 고아 정산의 게이트 — 이 프로세스가 지금 돌리고 있는 세션인가. */
export function isSessionLive(sessionKey: string | null | undefined): boolean {
  return sessionKey != null && liveSessionKey === sessionKey;
}
