// 그룹 카드 덱 첫 안내(groupDeck:v1)의 제품 정책을 UI와 분리한다.
// 완료 key 읽기 실패 때는 프로세스 세션 메모리로 fallback 노출을 한 번만 예약한다.
export const GROUP_DECK_GUIDE_ID = 'groupDeck:v1';

export type GroupDeckGuideReadState = 'incomplete' | 'completed' | 'unknown';
export type GroupDeckGuideExposureState = 'shown' | 'pending' | 'completed' | 'unknown';

export interface GroupDeckGuideDecision {
  exposure: GroupDeckGuideExposureState;
  queue: boolean;
}

let unknownFallbackReserved = false;
let completedThisSession = false;

export function resolveGroupDeckGuideDecision(
  readState: GroupDeckGuideReadState,
  blocked: boolean,
): GroupDeckGuideDecision {
  if (completedThisSession || readState === 'completed') {
    return { exposure: 'completed', queue: false };
  }
  if (readState === 'unknown') {
    if (unknownFallbackReserved) return { exposure: 'unknown', queue: false };
    unknownFallbackReserved = true;
    return { exposure: 'unknown', queue: true };
  }
  return { exposure: blocked ? 'pending' : 'shown', queue: true };
}

export function isGroupDeckGuideCompletedInSession(): boolean {
  return completedThisSession;
}

export function completeGroupDeckGuide(
  logCompleted: () => void,
  persist: () => Promise<unknown>,
  logWriteFailed: () => void,
): boolean {
  if (completedThisSession) return false;
  completedThisSession = true;
  logCompleted();
  persist().catch(logWriteFailed);
  return true;
}

export function resetGroupDeckGuideSessionForTests(): void {
  unknownFallbackReserved = false;
  completedThisSession = false;
}
