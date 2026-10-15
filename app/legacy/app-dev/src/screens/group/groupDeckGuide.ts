import { t } from '@/i18n';

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
        text: t('group.groupDeckGuide.emptyIntro'),
        character: 'hi',
        anchor: 'none',
      },
      {
        text: t('group.groupDeckGuide.emptySample'),
        character: 'study',
        anchor: 'active-card',
      },
      {
        text: t('group.groupDeckGuide.emptyTap'),
        character: 'study',
        anchor: 'active-card',
      },
      {
        text: t('group.groupDeckGuide.emptyBack'),
        character: 'happy',
        anchor: 'active-card',
        requiresBack: true,
      },
    ];
  }
  return [
    {
      text: t('group.groupDeckGuide.intro'),
      character: 'hi',
      anchor: 'none',
    },
    {
      text:
        groupCount >= 2
          ? t('group.groupDeckGuide.swipeMulti')
          : t('group.groupDeckGuide.swipeSingle'),
      character: 'study',
      anchor: 'active-card',
    },
    {
      text: t('group.groupDeckGuide.tap'),
      character: 'study',
      anchor: 'active-card',
    },
    {
      text: t('group.groupDeckGuide.back'),
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
