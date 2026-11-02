import AsyncStorage from '@react-native-async-storage/async-storage';
import { CANONICAL_BUILDINGS, type BuildingId } from '@/services/api/home';

export type AccountGuides = {
  focusDone: boolean;
  focusBlockingIntro?: 'pending' | 'seen';
  buildings: BuildingId[];
  completions: string[];
};
const empty = (): AccountGuides => ({ focusDone: false, buildings: [], completions: [] });
const key = (userId: string) => `gromo:account-guides:v1:${encodeURIComponent(userId)}`;
// 계정별 직렬 쓰기. 일반 앱 저장본 삭제·로그아웃과 독립적으로 유지한다.
const writes = new Map<string, Promise<AccountGuides>>();

export async function readAccountGuides(userId: string): Promise<AccountGuides> {
  const pending = writes.get(userId);
  if (pending) await pending.catch(() => undefined);
  const raw = await AsyncStorage.getItem(key(userId));
  return decode(raw);
}

function decode(raw: string | null): AccountGuides {
  if (raw === null) return empty();
  const value = JSON.parse(raw);
  if (
    !value ||
    typeof value.focusDone !== 'boolean' ||
    (value.focusBlockingIntro !== undefined &&
      !['pending', 'seen'].includes(value.focusBlockingIntro)) ||
    !Array.isArray(value.buildings) ||
    !Array.isArray(value.completions) ||
    value.buildings.some((b: BuildingId) => !CANONICAL_BUILDINGS.includes(b)) ||
    value.completions.some((id: unknown) => typeof id !== 'string')
  )
    throw new Error('안내 이력을 읽지 못했어요.');
  return value;
}

export function saveAccountGuides(
  userId: string,
  update: Partial<AccountGuides>,
): Promise<AccountGuides> {
  const prior = writes.get(userId);
  const write = (prior ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      // 자신의 쓰기 promise를 기다리지 않도록 저장소를 직접 읽는다.
      const raw = await AsyncStorage.getItem(key(userId));
      const current = decode(raw);
      const next = {
        focusDone: current.focusDone || !!update.focusDone,
        // 안내 소비는 되돌리지 않는다. 늦게 끝난 완료·이관 쓰기가 다시 예약하지 않게 한다.
        ...(current.focusBlockingIntro || update.focusBlockingIntro
          ? {
              focusBlockingIntro:
                current.focusBlockingIntro === 'seen' || update.focusBlockingIntro === 'seen'
                  ? ('seen' as const)
                  : ('pending' as const),
            }
          : {}),
        buildings: [...new Set([...current.buildings, ...(update.buildings ?? [])])],
        completions: [...new Set([...current.completions, ...(update.completions ?? [])])],
      };
      if (JSON.stringify(next) !== raw)
        await AsyncStorage.setItem(key(userId), JSON.stringify(next));
      return next;
    });
  writes.set(userId, write);
  void write
    .finally(() => {
      if (writes.get(userId) === write) writes.delete(userId);
    })
    .catch(() => undefined);
  return write;
}
