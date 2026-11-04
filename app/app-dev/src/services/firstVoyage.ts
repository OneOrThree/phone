import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, CLIENT_STALE_SESSION, request, uuid } from '@/services/api/client';
import { logMetaEvent, metaContext } from '@/services/metaSdk';
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
export async function arriveFirstVoyage(
  intent: FirstVoyageIntent,
  generation = sessionGeneration(),
): Promise<Arrival> {
  // 서버가 Meta로 첫 도착 이벤트를 보낼 매칭 값(GROMO-2742). 실패·지연이 도착을 막지 않게 1초로 끊는다.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const meta = await Promise.race([
    metaContext().catch(() => undefined),
    new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), 1000))),
  ]);
  clearTimeout(timer);
  // 기다리는 사이 로그아웃·계정 전환이 끝났으면 보내지 않는다 — 요청은 전송 시점의 토큰을 쓰므로 새 계정에 도착한다.
  if (generation !== sessionGeneration())
    throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
  const arrival = await request<Arrival>(
    `/islands/${encodeURIComponent(intent.destination.islandId)}/intro-arrivals`,
    {
      method: 'POST',
      idempotencyKey: intent.key,
      generation,
      ...(meta ? { body: { meta } } : {}),
    },
  );
  // 계정 첫 도착이면 서버 CAPI 와 같은 event_id 로 Meta SDK 에도 기록한다 — SKAN·AEM 은 기기 SDK 이벤트만 쓴다
  // (GROMO-2749). 기록 실패가 도착을 막지 않는다.
  // ponytail: SDK 가 아직 시작 전이면 이번 기록은 버린다(서버 CAPI 는 그대로 나감). 놓치는 일이 잦으면 대기열을 둔다.
  if (arrival.firstArrivalEventId)
    void logMetaEvent('first_island_arrival', arrival.firstArrivalEventId).catch(() => undefined);
  return arrival;
}
