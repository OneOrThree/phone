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
  if (groupCount === 0) {
    return [
      {
        text: '아직 참여한 그룹이 없어서 안내용 카드를 잠깐 보여 드릴게요.',
        character: 'hi',
        anchor: 'none',
      },
      {
        text: '그룹에 참여하면 내 그룹이 이런 카드로 보여요. 그룹이 늘면 옆으로 넘겨 볼 수 있어요.',
        character: 'study',
        anchor: 'active-card',
      },
      {
        text: '실제 카드를 탭하면 이 자리에서 오늘의 그룹 상태가 열려요.',
        character: 'study',
        anchor: 'active-card',
      },
      {
        text: '뒷면에서 집중 중인 멤버·챌린지·공지를 보고 바로 집중하거나 그룹 전체를 열어 볼 수 있어요.',
        character: 'happy',
        anchor: 'active-card',
        requiresBack: true,
      },
    ];
  }
  return [
    {
      text: '내 그룹이 카드로 모였어요. 같이 둘러봐요!',
      character: 'hi',
      anchor: 'none',
    },
    {
      text:
        groupCount >= 2
          ? '옆으로 넘기면 다른 그룹을 볼 수 있어요.'
          : '이 카드가 내 그룹이에요. 그룹이 늘면 옆으로 넘길 수 있어요.',
      character: 'study',
      anchor: 'active-card',
    },
    {
      text: '카드를 탭하면 이 자리에서 오늘의 그룹 상태가 열려요.',
      character: 'study',
      anchor: 'active-card',
    },
    {
      text: '집중 중인 멤버·챌린지·공지를 보고 바로 집중하거나 그룹 전체를 열어 볼 수 있어요.',
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
    return { exposure: 'unknown', queue: !unknownFallbackReserved };
  }
  return { exposure: blocked ? 'pending' : 'shown', queue: true };
}

/**
 * unknown fallback은 read 시점이 아니라 blocking overlay queue의 실제 slot을 얻은 시점에 소비한다.
 * 따라서 slot 전에 blur/unmount된 pending 요청은 다음 focus에서 다시 판정할 수 있다.
 */
export function claimGroupDeckGuideUnknownFallback(): boolean {
  if (unknownFallbackReserved || completedThisSession) return false;
  unknownFallbackReserved = true;
  return true;
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
