import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeveloperNotice } from '@/services/api/developerNotices';

// 운영진의 편지(GROMO-2615) — 계정별로 «본 공지의 visibleAt(epoch ms)»만 적는다. 로그아웃에도 유지한다.
export const letterSeenKey = (userId: string) =>
  `gromo:developer-letter-seen:v1:${encodeURIComponent(userId)}`;

// 예약 게시 공지는 publishedAt 이 startsAt 보다 앞서므로 둘 중 늦은 쪽이 «사용자에게 보이기 시작한 때»다
export const visibleAt = (n: DeveloperNotice) =>
  Math.max(Date.parse(n.startsAt) || 0, Date.parse(n.publishedAt) || 0);

/**
 * 저장값(없으면 null)과 목록으로 «기준만 저장» 또는 «편지 1건»을 정한다.
 * 키가 없는 첫 실행은 편지 없이 최신 시각(목록이 비면 0)만 저장해 기존 공지가 한꺼번에 뜨지 않게 한다.
 */
export function decideLetter(
  items: DeveloperNotice[],
  seen: number | null,
): { save: number } | { show: DeveloperNotice } | null {
  if (seen === null) return { save: Math.max(0, ...items.map(visibleAt)) };
  let best: DeveloperNotice | null = null;
  for (const n of items)
    if (n.forcesUpdate !== true && visibleAt(n) > seen && (!best || visibleAt(n) > visibleAt(best)))
      best = n;
  return best ? { show: best } : null;
}

/** 읽기 실패는 던진다 — 호출자가 이번 회차를 건너뛴다. */
export async function readLetterSeen(userId: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(letterSeenKey(userId));
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** 쓰기 실패는 무시한다(다음 실행에 한 번 더 뜰 뿐). */
export async function writeLetterSeen(userId: string, at: number): Promise<void> {
  try {
    await AsyncStorage.setItem(letterSeenKey(userId), String(at));
  } catch {}
}

/** 편지를 조회·표시해도 되는 때(GROMO-2615). 하나라도 깨지면 거짓이다. */
export function isLetterReady(g: {
  loaded: boolean;
  review: boolean;
  demo: boolean;
  hasServerSession: boolean;
  appActive: boolean;
  route: string;
  islandHomeShown: boolean;
  session: boolean;
  inTutorial: boolean;
  tutorialExperience: boolean;
  onboardingStory?: 'intro' | 'scope' | 'done';
  visiting: boolean;
  modal: boolean;
  convUi: boolean;
  switchAsk: boolean;
  appContentHidden: boolean;
  walkRequest: boolean;
  storageOwnerReady: boolean;
  sceneGuide: boolean;
  keyboardHeight: number;
  incomingAppLink: boolean;
  openingInvitation: boolean;
}): boolean {
  return (
    g.loaded &&
    !g.review &&
    !g.demo &&
    g.hasServerSession &&
    g.appActive &&
    (g.route === 'sea' || (g.route === 'home' && g.islandHomeShown)) &&
    !g.session &&
    !g.inTutorial &&
    !g.tutorialExperience &&
    g.onboardingStory !== 'intro' &&
    g.onboardingStory !== 'scope' &&
    !g.visiting &&
    !g.modal &&
    !g.convUi &&
    !g.switchAsk &&
    !g.appContentHidden &&
    !g.walkRequest &&
    g.storageOwnerReady &&
    !g.sceneGuide &&
    g.keyboardHeight === 0 &&
    !g.incomingAppLink &&
    !g.openingInvitation
  );
}
