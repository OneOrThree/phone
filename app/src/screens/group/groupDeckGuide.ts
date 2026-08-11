// 그룹 카드 덱 첫 안내(groupDeck:v1)의 제품 정책을 UI와 분리한다.
// 가입 온보딩과 무관한 기기 전역 1회 안내이며, 완료 key 읽기에 실패한 경우에만
// 프로세스 세션 메모리로 재시도를 한 번으로 제한한다.

export const GROUP_DECK_GUIDE_ID = 'groupDeck:v1';

export type GroupDeckGuideAnchor = 'none' | 'deck' | 'active-card';
export type GroupDeckGuideReadState = 'incomplete' | 'completed' | 'unknown';
export type GroupDeckGuideExposureState = 'shown' | 'pending' | 'completed' | 'unknown';

export interface GroupDeckGuideStepConfig {
  text: string;
  character: 'hi' | 'study' | 'happy';
  anchor: GroupDeckGuideAnchor;
  requiresBack?: boolean;
}

export interface GroupDeckGuideDecision {
  exposure: GroupDeckGuideExposureState;
  queue: boolean;
}

let unknownFallbackReserved = false;
let completedThisSession = false;

export function groupDeckGuideSteps(groupCount: number): GroupDeckGuideStepConfig[] {
  return [
    {
      text: '내 그룹이 카드로 모였어. 같이 둘러보자!',
      character: 'hi',
      anchor: 'none',
    },
    {
      text:
        groupCount >= 2
          ? '옆으로 넘기면 다른 그룹을 볼 수 있어.'
          : '이 카드가 내 그룹이야. 그룹이 늘면 옆으로 넘길 수 있어.',
      character: 'study',
      anchor: 'deck',
    },
    {
      text: '카드를 탭하면 이 자리에서 오늘의 방 상태가 열려.',
      character: 'study',
      anchor: 'active-card',
    },
    {
      text: '집중 중인 멤버·챌린지·공지를 보고 바로 집중하거나 방 전체를 열어봐.',
      character: 'happy',
      anchor: 'active-card',
      requiresBack: true,
    },
  ];
}

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

export function markGroupDeckGuideCompletedInSession(): void {
  completedThisSession = true;
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
  // 제품 완료는 마지막 action에서 확정한다. 영속 write는 그 뒤의 best-effort 작업이다.
  logCompleted();
  persist().catch(logWriteFailed);
  return true;
}

// Jest에서 앱 프로세스 경계를 재현하기 위한 테스트 전용 reset이다.
export function resetGroupDeckGuideSessionForTests(): void {
  unknownFallbackReserved = false;
  completedThisSession = false;
}
