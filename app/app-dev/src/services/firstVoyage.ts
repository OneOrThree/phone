import AsyncStorage from '@react-native-async-storage/async-storage';
import { request, uuid } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import type { Arrival, TelescopeItem } from '@/services/api/telescope';

/** 설치 단위로만 보관한다. 계정 서버 이력·키체인에 남기지 않아 재설치하면 다시 체험할 수 있다. */
export const FIRST_VOYAGE_DONE = 'catus:first-voyage:done:v1';
const pendingKey = (owner: string) => `catus:first-voyage:pending:v1:${owner}`;
export type FirstVoyageIntent = { destination: TelescopeItem; key: string };

export async function readFirstVoyage(owner: string) {
  const [done, raw] = await Promise.all([
    AsyncStorage.getItem(FIRST_VOYAGE_DONE),
    AsyncStorage.getItem(pendingKey(owner)),
  ]);
  if (done === '1') return { eligible: false, pending: null };
  let pending: FirstVoyageIntent | null = null;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (typeof parsed?.key === 'string' && typeof parsed?.destination?.islandId === 'string')
      pending = parsed;
  } catch {
    // 손상된 체험 의도는 새로 선택한다. 완료 이력과 별개여서 사용자를 막지 않는다.
  }
  return { eligible: true, pending };
}

export async function prepareFirstVoyage(owner: string, destination: TelescopeItem) {
  const saved = await readFirstVoyage(owner);
  const intent = saved.pending ?? { destination, key: uuid() };
  await AsyncStorage.setItem(pendingKey(owner), JSON.stringify(intent));
  return intent;
}

export async function completeFirstVoyage(owner: string) {
  await AsyncStorage.setItem(FIRST_VOYAGE_DONE, '1');
  await AsyncStorage.removeItem(pendingKey(owner));
}

export function clearFirstVoyageIntent(owner: string) {
  return AsyncStorage.removeItem(pendingKey(owner));
}

/** 실제 집중을 생성하지 않는다. 서버 receipt가 무인도 생성·도착의 응답 유실 재시도를 처리한다. */
export function arriveFirstVoyage(
  intent: FirstVoyageIntent,
  generation = sessionGeneration(),
): Promise<Arrival> {
  return request(`/islands/${encodeURIComponent(intent.destination.islandId)}/intro-arrivals`, {
    method: 'POST',
    idempotencyKey: intent.key,
    generation,
  });
}
