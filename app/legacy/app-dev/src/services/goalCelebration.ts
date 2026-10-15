// 목표 달성 축하 예약(GROMO-630) 저장/조회 + 변경 구독 — 결과 화면이 예약하고 홈이 소비한다.
// 구독이 필요한 이유: 홈은 포커스 시점에만 예약 키를 읽는데, "홈으로"를 서버 판정보다 빨리
// 누르면 홈 포커스가 예약 저장보다 먼저 지나가 모달이 다음 재진입까지 밀린다(PR 225 후속 리뷰).
// 저장 완료 시 구독자(홈)에 알려 그 자리에서 모달이 뜨게 한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';
import { todayStrKst } from '@/utils/localDate';

export interface PendingCelebration {
  date: string; // 달성한 날짜(YYYY-MM-DD, KST — celebrationDayKey) — 모달을 닫을 때 이 날짜로 기록한다
  days: number; // 연속 목표달성 일수
  goalMinutes?: number;
}

// 목표 달성 축하의 dedup 기준일 — 달성 판정이 서버 KST 일 버킷으로 내려지므로, '하루 1회' 가드
// 키도 같은 축이어야 한다(GROMO-1236 P2 6라운드). 로컬 날짜로 걸면 한 KST 하루가 로컬 이틀에
// 걸리는 기기에서 같은 달성이 두 번 축하된다. 예약 date(위 PendingCelebration)·소비 측 비교
// (HomeScreen)·노출 완료 기록(focusGoalCelebratedDate) 전부 이 키에서 파생한다 — 반쪽 이전은
// dedup을 반대로 깨뜨리므로 체인 전체가 한 축이어야 한다.
export function celebrationDayKey(): string {
  return todayStrKst();
}

type CelebrationListener = () => void;
const listeners = new Set<CelebrationListener>();

export function subscribeCelebration(listener: CelebrationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 축하 예약 저장 — 저장이 끝난 뒤 구독자에 알린다.
export async function schedulePendingCelebration(pending: PendingCelebration): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.focusGoalCelebratePending, JSON.stringify(pending));
  listeners.forEach((listener) => listener());
}

// 예약 조회 — 값이 없거나 깨졌으면 null(깨진 값은 지워서 자가 정리).
export async function readPendingCelebration(): Promise<PendingCelebration | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.focusGoalCelebratePending);
    if (!raw) return null;
    const p = JSON.parse(raw) as { date?: string; days?: number; goalMinutes?: number };
    if (typeof p.date !== 'string') {
      clearPendingCelebration().catch(() => {});
      return null;
    }
    return { date: p.date, days: p.days ?? 1, goalMinutes: p.goalMinutes };
  } catch {
    clearPendingCelebration().catch(() => {});
    return null;
  }
}

// 예약 제거 — 모달 노출 후(닫기) 또는 지난 날짜 예약 정리에 사용.
export async function clearPendingCelebration(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.focusGoalCelebratePending);
}
