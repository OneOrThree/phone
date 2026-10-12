/**
 * 망원경 API (GROMO-2266 · 서버 계약 GROMO-2260 도착 · GROMO-2265 목록) — 공개 business-api 의 무접두 경로,
 * `{data}` 언랩. 서버가 아직 없어도 이 계약 모양으로 쓰고 테스트는 목으로 검증한다.
 *
 *  - `GET  /me/telescope`            지금 시간대(1시간 버킷)의 섬 최대 8개 — 소속 ≤3 + 가까운 섬 1 +
 *                                    무작위·찜 4. 게스트도 읽고 전망대 게이트가 없다. 순서도 서버가 정한다.
 *  - `POST /islands/{id}/arrivals`   도착 기록(멱등, 본문 없음). `Idempotency-Key` 필수 — `PUT /me/current-island` 와
 *                                    같다: 키는 호출부가 의도당 한 번 만들고, 응답 유실 재시도는 같은 키로 보낸다.
 *                                    주민이면 서버가 현재 섬도 옮기고, 비주민은 기록만 한다(방문). 미존재·비공개 비주민은 404.
 *  - `POST /me/telescope/pins`       섬을 망원경에 넣는다(GROMO-2269 전망대 · 서버 GROMO-2268). `{ islandId, source }`,
 *                                    `Idempotency-Key` 불필요(이미 넣은 섬이면 200 으로 같은 본문). 5번째면 가장 오래된
 *                                    핀이 빠지고 `evicted` 로 온다. 없는·비공개 섬 404 `GROUP_NOT_FOUND` · 강퇴 섬 403
 *                                    `FORBIDDEN` · 내 소속 섬 409 `STATE_CONFLICT`.
 *
 * 망원경 목록을 서버에서 바꾸는 요청(지금은 넣기)이 성공하면 `onTelescopeChanged` 구독자에게 알린다. 열려 있는 목록이 다시 읽는 데
 * 쓴다 — 요청이 느려 끝나기 전에 망원경을 열어 옛 목록을 받아 둔 경우를 메운다.
 *
 * 가입의 `origin: 'telescope'` 는 `islands.ts joinIsland` 가 맡는다 — 즉시 가입이어도 현재 섬을 옮기지 않는다.
 */
import { ApiError, request } from './client';
import { CLIENT_CONTRACT_ERROR } from './home';

export type TelescopeItem = {
  islandId: string;
  name: string;
  intro: string;
  memberCount: number;
  maxMembers: number;
  approvalRequired: boolean;
  membershipStatus: 'none' | 'pending' | 'active';
  /** joined = 내 소속 섬, nearby = 가까운 섬(15분), random = 무작위, pinned = 찜(잡지·전망대). */
  slot: 'joined' | 'nearby' | 'random' | 'pinned';
  sailingMinutes: number;
  /** 섬 주민 1인당 하루 평균 집중 분(최근 7일). 아직 집계 전이면 null. */
  averageFocusMinutesPerDay: number | null;
  /** 정원이 찬 섬 — 구경(항해)은 되고 가입만 막힌다. */
  full: boolean;
  /** 한 번 가 본 섬 — 소속 섬이면 항해 없이 돌아갈 수 있다. */
  arrivedBefore: boolean;
  pinnedFrom?: 'magazine' | 'observatory';
  pinnedAt?: string;
};

export type Telescope = {
  /** 이 목록이 속한 1시간 버킷의 시작(UTC). */
  bucketStart: string;
  /** 다음 버킷(새 섬)까지 남은 분. */
  nextRefreshMinutes: number;
  items: TelescopeItem[];
};

export type Arrival = {
  islandId: string;
  arrivedBefore: true;
  membershipStatus: 'none' | 'pending' | 'active';
  currentIslandId: string | null;
};

/** 망원경에 넣은 곳 — 전망대(검색·랭킹)는 `observatory`, 잡지는 `magazine`(E4-5). */
export type PinSource = 'observatory' | 'magazine';

export type PinResult = {
  /** 목록의 핀 칸(`slot === 'pinned'`)에 들어간 섬. */
  item: TelescopeItem;
  /** 핀이 가득 차 빠진 가장 오래된 섬. 안 빠졌으면 null. */
  evicted: { islandId: string; name: string } | null;
};

const telescopeListeners = new Set<() => void>();

/**
 * 망원경 목록이 서버에서 바뀌면(넣기 성공 — 목록을 바꾸는 다른 요청도 같은 신호를 쓴다) 불릴 구독자를 등록하고 해제 함수를 돌려준다.
 * 화면을 떠난 뒤 끝난 요청도 알림은 나간다 — 구독자가 없으면 아무 일도 없고, 다음에 열 때 새로 읽는다.
 */
export function onTelescopeChanged(listener: () => void): () => void {
  telescopeListeners.add(listener);
  return () => telescopeListeners.delete(listener);
}

function notifyTelescopeChanged(): void {
  telescopeListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // 구독자 하나의 실패가 이미 서버에 반영된 요청을 실패로 보이게 하거나 다른 구독자를 막지 않는다(subscribeSession 과 같다).
    }
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const contractError = (field: string) =>
  new ApiError(CLIENT_CONTRACT_ERROR, `계약과 다른 응답입니다 (${field}).`, 0, { field });

/** 화면이 그리는 필드만 본다 — 모양이 어긋난 항목으로 NaN 이 뜨거나 크래시하지 않게 오류 상태로 보낸다. */
function validateTelescope(raw: unknown): Telescope {
  if (!isRecord(raw) || !Array.isArray(raw.items) || typeof raw.nextRefreshMinutes !== 'number')
    throw contractError('items');
  for (const item of raw.items) {
    if (
      !isRecord(item) ||
      typeof item.islandId !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.memberCount !== 'number' ||
      typeof item.maxMembers !== 'number' ||
      typeof item.sailingMinutes !== 'number'
    )
      throw contractError('items');
  }
  return raw as unknown as Telescope;
}

export async function getTelescope(): Promise<Telescope> {
  return validateTelescope(await request<unknown>('/me/telescope'));
}

/**
 * 항해를 마친 섬에 도착을 기록한다. `membershipStatus === 'active'` 면 서버가 현재 섬을 그 섬으로 옮겼다.
 * `idempotencyKey` 는 필수다 — `switchCurrentIsland` 와 같은 방식으로 헤더에 싣는다(응답 유실 재시도는 같은 키).
 */
export function arriveAtIsland(islandId: string, idempotencyKey: string): Promise<Arrival> {
  return request<Arrival>(`/islands/${encodeURIComponent(islandId)}/arrivals`, {
    method: 'POST',
    idempotencyKey,
  });
}

/**
 * 섬을 망원경에 넣는다(GROMO-2269). 응답 유실 재시도가 안전하다 — 이미 넣은 섬은 서버가 같은 본문으로 답한다(첫 `source` 유지).
 * 거절은 공개 오류 코드 그대로 올라간다: 없는·종료·비공개 섬 `GROUP_NOT_FOUND`, 강퇴 섬 `FORBIDDEN`(일반 권한 오류와 코드로는
 * 구분되지 않는다), 내 소속 섬 `STATE_CONFLICT`. 게스트도 넣을 수 있다.
 */
export async function pinToTelescope(islandId: string, source: PinSource): Promise<PinResult> {
  const result = await request<PinResult>('/me/telescope/pins', {
    method: 'POST',
    body: { islandId, source },
  });
  notifyTelescopeChanged();
  return result;
}
