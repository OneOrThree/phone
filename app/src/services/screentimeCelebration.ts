// 스크린타임 목표 달성 축하 예약(GROMO-629) 저장/조회 + 변경 구독 — screentimeSync(어제 마감)가
// 예약하고 홈이 소비한다. 구조는 포커스 목표 축하(goalCelebration.ts)와 동일 패턴.
// 구독이 필요한 이유: 홈은 포커스 시점에만 예약 키를 읽는데, 앱 시작 동기화가 홈 포커스보다
// 늦게 끝나면 모달이 다음 재진입까지 밀린다. 저장 완료 시 구독자(홈)에 알려 그 자리에서 뜨게 한다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/types/storage';

export interface PendingScreenTimeCelebration {
  date: string; // 노출 대상일(YYYY-MM-DD, 보통 오늘) — 모달을 닫을 때 이 날짜로 기록(하루 1회 가드)
  days: number; // 연속 목표달성 일수(어제 포함)
}

type CelebrationListener = () => void;
const listeners = new Set<CelebrationListener>();

export function subscribeScreenTimeCelebration(listener: CelebrationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// 축하 예약 저장 — 저장이 끝난 뒤 구독자에 알린다.
export async function schedulePendingScreenTimeCelebration(
  pending: PendingScreenTimeCelebration,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.screentimeCelebratePending, JSON.stringify(pending));
  listeners.forEach((listener) => listener());
}

// 예약 조회 — 값이 없거나 깨졌으면 null(깨진 값은 지워서 자가 정리).
export async function readPendingScreenTimeCelebration(): Promise<PendingScreenTimeCelebration | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.screentimeCelebratePending);
    if (!raw) return null;
    const p = JSON.parse(raw) as { date?: string; days?: number };
    if (typeof p.date !== 'string') {
      clearScreenTimeCelebration().catch(() => {});
      return null;
    }
    return { date: p.date, days: p.days ?? 1 };
  } catch {
    clearScreenTimeCelebration().catch(() => {});
    return null;
  }
}

// 예약 제거 — 모달 노출 후(닫기) 또는 지난 날짜 예약 정리에 사용.
export async function clearScreenTimeCelebration(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.screentimeCelebratePending);
}
