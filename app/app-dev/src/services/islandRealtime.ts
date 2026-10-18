/**
 * 섬 주민 집중/휴식과 공용 재생 실시간 동기화 (GROMO-2010, GROMO-1845).
 *
 * 정본은 `GET /islands/{id}/focus-members`·`/rest-members` 스냅숏이고
 * STOMP `SUB /topic/islands/{id}/focus|rest|emotes|playback` 이벤트를 구독한다.
 * 응원은 `SEND /app/islands/{id}/focus/emotes` — HTTP 응원 경로는 없고
 * 발신 성공 화면은 서버 브로드캐스트가 돌아올 때만 그린다.
 *
 * 방어 규칙(실시간 이벤트 LLD §5):
 *  - 워터마크가 없는 userId 이벤트는 버리고 정본 재조회로 복구한다 — 이벤트만으로
 *    주민 프로필을 만들 수 없다.
 *  - `aggregateVersion` 이 알고 있는 버전 이하이면 중복·역순으로 버린다.
 *  - `schemaVersion !== 1`, 모르는 type, 다른 섬 이벤트는 버리고 워터마크도 진행하지 않는다.
 *  - 응원은 `eventId` 중복 제거와 `expiresAt` TTL만 적용한다(버전 없음).
 *
 * 홈 섬 이동(GROMO-2248)은 같은 채널 함수로 **이동 전용 연결**을 따로 연다(`movement: true`) —
 * `SUB /topic/islands/{id}/movement`·`/movement/snapshot`, `SEND /app/islands/{id}/movement/intent`.
 * 메시지 해석은 `movementSync.ts` 가 맡는다.
 */
import { Client, type IFrame, type IMessage } from '@stomp/stompjs';
import { t } from '@/i18n';
import { API_URL, ApiError } from '@/services/api/client';
import { getAccessToken, getSession } from '@/services/api/session';
import type { MoveIntent } from '@/services/movementSync';
import {
  focusMembers,
  restMembers,
  type FocusMember,
  type MembersSnapshot,
  type ProjectionWatermark,
  type RestMember,
} from '@/services/api/islands';

/** 서버가 허용하는 응원 타입 — 그 외는 서버가 400으로 거절하므로 미리 걸러낸다. */
export const EMOTE_TYPES = new Set(['hello', 'cheer', 'sleepy', 'laugh', 'hearts']);

export type RealtimeEnvelope = {
  eventId?: unknown;
  schemaVersion?: unknown;
  type?: unknown;
  islandId?: unknown;
  aggregateVersion?: unknown;
  occurredAt?: unknown;
  payload?: unknown;
};

export type LiveFocusMember = FocusMember & {
  /** activeSeconds 의 기준 시각(서버 시계 ms). active 면 여기서부터 경과를 더해 그린다. */
  anchorMs: number;
};
export type LiveRestMember = RestMember & { anchorMs: number };
export type LiveEmote = {
  eventId: string;
  userId: string;
  type: string;
  expiresAtMs: number;
  visitor?: boolean;
};

export type GoldenFishMember = { userId: string; sessionId: string };
export type GoldenFishEvent = {
  eventId: string;
  islandId: string;
  drawnAt: string;
  reward: number;
  sharePerMember: number;
  members: GoldenFishMember[];
};

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 서버가 확정한 focus.golden 봉투만 컷신 신호로 인정한다. 확률·보상 계산은 앱에서 하지 않는다. */
export function parseGoldenFishEvent(raw: unknown, islandId: string): GoldenFishEvent | null {
  const env = raw as RealtimeEnvelope;
  if (
    !env ||
    typeof env !== 'object' ||
    env.schemaVersion !== 1 ||
    env.type !== 'focus.golden' ||
    env.islandId !== islandId
  )
    return null;
  const eventId = str(env.eventId);
  const payload = env.payload as Record<string, unknown> | null;
  const drawnAt = str(payload?.drawnAt);
  const reward = num(payload?.reward);
  const sharePerMember = num(payload?.sharePerMember);
  if (
    !eventId ||
    payload?.islandId !== islandId ||
    !drawnAt ||
    !ISO_INSTANT.test(drawnAt) ||
    !Number.isFinite(Date.parse(drawnAt)) ||
    reward === null ||
    !Number.isInteger(reward) ||
    reward <= 0 ||
    sharePerMember === null ||
    !Number.isInteger(sharePerMember) ||
    sharePerMember < 0
  )
    return null;
  if (!Array.isArray(payload?.members) || payload.members.length < 2) return null;
  const members: GoldenFishMember[] = [];
  for (const value of payload.members) {
    const member = value as Record<string, unknown> | null;
    const userId = str(member?.userId);
    const sessionId = str(member?.sessionId);
    if (!userId || !UUID.test(userId) || !sessionId || !UUID.test(sessionId)) return null;
    members.push({ userId, sessionId });
  }
  const uniqueMembers = new Set(members.map((member) => `${member.userId}:${member.sessionId}`));
  if (
    uniqueMembers.size !== members.length ||
    sharePerMember !== Math.floor(reward / members.length)
  )
    return null;
  return { eventId, islandId, drawnAt, reward, sharePerMember, members };
}

/** `island.member.arrived`(GROMO-2302) — 주민이 이 섬에 처음 도착했다. */
export type MemberArrivedEvent = {
  eventId: string;
  userId: string;
  name: string | null;
  catColor: string | null;
};

/** 7필드 봉투 + payload{islandId,userId,name,catColor,arrivedAt} 만 인정한다. 모양이 다르면 null. */
export function parseMemberArrivedEvent(raw: unknown, islandId: string): MemberArrivedEvent | null {
  const env = raw as RealtimeEnvelope;
  if (
    !env ||
    typeof env !== 'object' ||
    env.schemaVersion !== 1 ||
    env.type !== 'island.member.arrived' ||
    env.islandId !== islandId
  )
    return null;
  const eventId = str(env.eventId);
  const p = env.payload as Record<string, unknown> | null;
  const userId = str(p?.userId);
  if (!eventId || !userId || p?.islandId !== islandId) return null;
  return { eventId, userId, name: str(p?.name), catColor: str(p?.catColor) };
}

/**
 * 도착 사건 필터 — `eventId` 로 중복만 거르고(`aggregateVersion` 은 섬 전체 카운터라 (섬, 사용자) 워터마크와 비교하지 않는다)
 * 내 도착은 버린다. 받는 사람 기준 차단은 서버가 이미 걸렀다.
 */
export function memberArrivalFilter(islandId: string, selfId: () => string | undefined) {
  const seen = new Set<string>();
  const order: string[] = [];
  return (raw: unknown): MemberArrivedEvent | null => {
    const event = parseMemberArrivedEvent(raw, islandId);
    if (!event || seen.has(event.eventId)) return null;
    seen.add(event.eventId);
    order.push(event.eventId);
    if (order.length > 200) seen.delete(order.shift()!);
    return event.userId === selfId() ? null : event;
  };
}

/** 「○○님이 도착했어요」 토스트 문구 — 이름이 없으면 「누군가」. */
export const memberArrivedText = (event: MemberArrivedEvent) =>
  t('focusFlow.memberArrived', { name: event.name ?? t('openSea.someone') });

export const sessionSelfId = () => getSession()?.userId;

export function isGoldenFishParticipant(
  event: GoldenFishEvent,
  userId: string | null | undefined,
  sessionId?: string | null,
): boolean {
  if (!userId) return false;
  return event.members.some(
    (member) => member.userId === userId && (!sessionId || member.sessionId === sessionId),
  );
}

export type IslandPresenceTransition =
  | {
      source: 'event' | 'event-gap';
      kind: 'focus';
      userId: string;
      occurredAtMs?: number;
      previous: LiveFocusMember | null;
      current: LiveFocusMember | null;
    }
  | {
      source: 'event' | 'event-gap';
      kind: 'rest';
      userId: string;
      occurredAtMs?: number;
      previous: LiveRestMember | null;
      current: LiveRestMember | null;
    };

type ProjectionApplyResult = { changed: boolean; transition: IslandPresenceTransition | null };

const ms = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : NaN);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 한 섬의 focus/rest 프로젝션. 순수 상태라 단위 테스트가 그대로 가능하다.
 * 스냅숏은 통째로 교체하고 이벤트는 워터마크 규칙으로만 반영한다.
 */
export class IslandProjection {
  private focusMap = new Map<string, LiveFocusMember>();
  private restMap = new Map<string, LiveRestMember>();
  private versions = new Map<string, number>();
  private seenEmotes = new Set<string>();
  private emoteQueue: string[] = [];
  private emoteMap = new Map<string, LiveEmote>();
  /** 서버 시각 − 단말 시각(ms). 경과 시간 표시와 응원 TTL 판정에 쓴다. */
  clockOffset = 0;
  /** 모르는 주민 이벤트가 왔다 — 정본 재조회가 필요하다. */
  resyncNeeded = false;

  constructor(readonly islandId: string) {}

  serverNowMs(): number {
    return Date.now() + this.clockOffset;
  }

  focus(): LiveFocusMember[] {
    return [...this.focusMap.values()];
  }

  rest(): LiveRestMember[] {
    return [...this.restMap.values()];
  }

  emotes(): LiveEmote[] {
    this.sweepEmotes();
    return [...this.emoteMap.values()];
  }

  loadFocus(snap: MembersSnapshot<FocusMember>): void {
    this.focusMap.clear();
    this.anchor(snap.serverNow);
    const anchorMs = ms(snap.serverNow);
    for (const m of snap.items ?? []) {
      if (!m || typeof m.userId !== 'string' || typeof m.sessionId !== 'string') continue;
      this.focusMap.set(m.userId, {
        ...m,
        status: m.status === 'paused' ? 'paused' : 'active',
        anchorMs: Number.isFinite(anchorMs) ? anchorMs : Date.now(),
      });
    }
    this.seed('focus.member', snap.watermarks);
  }

  loadRest(snap: MembersSnapshot<RestMember>): void {
    this.restMap.clear();
    this.anchor(snap.serverNow);
    const anchorMs = ms(snap.serverNow);
    for (const m of snap.items ?? []) {
      if (!m || typeof m.userId !== 'string') continue;
      this.restMap.set(m.userId, {
        ...m,
        anchorMs: Number.isFinite(anchorMs) ? anchorMs : Date.now(),
      });
    }
    this.seed('rest.member', snap.watermarks);
  }

  /** 이벤트를 반영한다. 보이는 상태가 바뀌면 true — publish 여부 판단에 쓴다. */
  apply(raw: unknown): boolean {
    return this.applyWithTransition(raw).changed;
  }

  /** 반영 결과와 실제 멤버 상태 경계 변화(애니메이션 대상)를 함께 돌려준다. */
  applyWithTransition(raw: unknown): ProjectionApplyResult {
    const env = raw as RealtimeEnvelope;
    if (!env || typeof env !== 'object') return { changed: false, transition: null };
    if (env.schemaVersion !== 1) return { changed: false, transition: null };
    if (env.islandId !== this.islandId) return { changed: false, transition: null };
    this.anchor(env.occurredAt);
    switch (env.type) {
      case 'focus.member.updated':
        return this.applyMember('focus', env);
      case 'rest.member.updated':
        return this.applyMember('rest', env);
      case 'focus.emote':
        return { changed: this.applyEmote(env), transition: null };
      default:
        return { changed: false, transition: null };
    }
  }

  /** 만료된 응원을 지우고 다음 만료 시각(서버 ms)을 돌려준다 — UI 재그리기 예약에 쓴다. */
  sweepEmotes(): number | null {
    const now = this.serverNowMs();
    let next: number | null = null;
    for (const [userId, e] of this.emoteMap) {
      if (e.expiresAtMs <= now) this.emoteMap.delete(userId);
      else if (next === null || e.expiresAtMs < next) next = e.expiresAtMs;
    }
    return next;
  }

  private anchor(iso: unknown): void {
    const t = ms(iso);
    if (Number.isFinite(t)) this.clockOffset = t - Date.now();
  }

  private seed(projection: string, watermarks?: ProjectionWatermark[]): void {
    for (const w of watermarks ?? []) {
      if (w.projection !== projection || typeof w.aggregateId !== 'string') continue;
      const version = num(w.version);
      if (version !== null) this.versions.set(`${projection}:${w.aggregateId}`, version);
    }
  }

  private applyMember(kind: 'focus' | 'rest', env: RealtimeEnvelope): ProjectionApplyResult {
    const p = env.payload as Record<string, unknown> | null;
    const userId = str(p?.userId);
    const version = num(env.aggregateVersion);
    if (!userId || version === null) return { changed: false, transition: null };
    const key = `${kind}.member:${userId}`;
    const occurredAtMs = ms(env.occurredAt);
    const transitionAt = Number.isFinite(occurredAtMs) ? occurredAtMs : this.serverNowMs();
    const known = this.versions.get(key);
    if (known === undefined) {
      // 워터마크가 없는 주민 — 이벤트만으로 프로필을 지어내지 않고 정본 재조회로 복구한다.
      this.resyncNeeded = true;
      return { changed: false, transition: null };
    }
    if (version <= known) return { changed: false, transition: null };
    this.versions.set(key, version);
    const status = p?.status;
    const anchor = ms(p?.serverNow);
    if (kind === 'focus') {
      const prev = this.focusMap.get(userId);
      if (status === 'completed') {
        const changed = this.focusMap.delete(userId);
        return {
          changed,
          transition: changed
            ? {
                source: 'event',
                kind,
                userId,
                occurredAtMs: transitionAt,
                previous: prev!,
                current: null,
              }
            : null,
        };
      }
      this.focusMap.set(userId, {
        userId,
        name: prev?.name ?? null,
        catColor: prev?.catColor ?? null,
        appearance: prev?.appearance ?? null,
        sessionId: str(p?.sessionId) ?? prev?.sessionId ?? '',
        subject: str(p?.subject) ?? prev?.subject ?? '',
        activeSeconds: num(p?.activeSeconds) ?? 0,
        status: status === 'paused' ? 'paused' : 'active',
        anchorMs: Number.isFinite(anchor) ? anchor : this.serverNowMs(),
      });
      const current = this.focusMap.get(userId)!;
      return {
        changed: true,
        transition:
          prev?.status !== current.status || prev?.sessionId !== current.sessionId
            ? {
                source: 'event',
                kind,
                userId,
                occurredAtMs: transitionAt,
                previous: prev ?? null,
                current,
              }
            : null,
      };
    }
    if (status === 'paused') {
      const prev = this.restMap.get(userId);
      this.restMap.set(userId, {
        userId,
        name: prev?.name ?? null,
        catColor: prev?.catColor ?? null,
        restSeat: num(p?.restSeat) ?? prev?.restSeat ?? null,
        restStartedAt: str(p?.restStartedAt) ?? prev?.restStartedAt ?? null,
        anchorMs: Number.isFinite(anchor) ? anchor : this.serverNowMs(),
      });
      const current = this.restMap.get(userId)!;
      return {
        changed: true,
        transition: prev
          ? null
          : {
              source: 'event',
              kind,
              userId,
              occurredAtMs: transitionAt,
              previous: null,
              current,
            },
      };
    }
    const prev = this.restMap.get(userId);
    const changed = this.restMap.delete(userId);
    return {
      changed,
      transition: changed
        ? {
            source: 'event',
            kind,
            userId,
            occurredAtMs: transitionAt,
            previous: prev!,
            current: null,
          }
        : null,
    };
  }

  /** 방문자가 보낸 응원(GROMO-2259) — 머리 위 말풍선 대신 호출부가 알림으로 보인다. */
  onVisitorEmote: ((emote: LiveEmote) => void) | null = null;

  private applyEmote(env: RealtimeEnvelope): boolean {
    const eventId = str(env.eventId);
    if (!eventId || this.seenEmotes.has(eventId)) return false;
    const p = env.payload as Record<string, unknown> | null;
    const userId = str(p?.userId);
    const type = str(p?.type);
    const expiresAtMs = ms(p?.expiresAt);
    if (!userId || !type || !Number.isFinite(expiresAtMs)) return false;
    this.seenEmotes.add(eventId);
    this.emoteQueue.push(eventId);
    // ponytail: 최근 200개까지만 기억 — 3초짜리 임시 이벤트라 넘어간 id 재도착은 사실상 없다.
    if (this.emoteQueue.length > 200) this.seenEmotes.delete(this.emoteQueue.shift()!);
    if (expiresAtMs <= this.serverNowMs()) return false;
    if (p?.visitor === true) {
      this.onVisitorEmote?.({ eventId, userId, type, expiresAtMs, visitor: true });
      return false;
    }
    this.emoteMap.set(userId, { eventId, userId, type, expiresAtMs });
    return true;
  }
}

export type PresenceView = {
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  focus: LiveFocusMember[];
  rest: LiveRestMember[];
  emotes: LiveEmote[];
  clockOffset: number;
  /** 초기·수동·재연결 스냅숏이 적용될 때만 바뀐다. event-gap 복구는 전이 콜백으로 연출한다. */
  snapshotVersion?: number;
  /** 스냅숏 조회 중 도착해 최종 뷰에 선반영된 이벤트. actor가 기준 상태를 복원해 모션을 잇는다. */
  snapshotTransitions?: IslandPresenceTransition[];
};

export const EMPTY_PRESENCE: PresenceView = {
  status: 'loading',
  error: null,
  focus: [],
  rest: [],
  emotes: [],
  clockOffset: 0,
  snapshotVersion: 0,
  snapshotTransitions: [],
};

let nextSnapshotVersion = 0;

/** 섬 단위 STOMP 채널 — 구독 수명은 채널과 같고 끊기면 서버가 구독을 다 버린다. */
export type IslandChannel = {
  send(destination: string, body: unknown): boolean;
  /** focus/rest 연결은 유지하고 emotes 구독만 바꾼다. */
  setEmoteEnabled(enabled: boolean): void;
  /** 소켓을 끊고 다시 연다 — 구독은 새 연결에서 다시 맺는다. */
  reopen(): void;
  close(): void;
};

export type IslandChannelOpts = {
  islandId: string;
  /** focus/rest 채널. 생략하면 기존 동작대로 구독한다. */
  presence?: boolean;
  /** 공용 재생 전체 상태 채널. */
  playback?: boolean;
  /**
   * 홈 섬 이동 채널(GROMO-2248) — movement·movement/snapshot 을 구독한다. 거절(STOMP ERROR, 오류 큐의
   * `NOT_A_MEMBER`)을 한 번 받으면 이 채널은 재접속해도 다시 구독하지 않는다.
   */
  movement?: boolean;
  /**
   * 주민 소식 채널(GROMO-2311) — `/topic/islands/{id}/events`. **현재 소속 주민만** 구독할 수 있다(비주민은 ERROR 뒤
   * 소켓 종료). 어떤 ERROR 든 한 번 받으면 이 채널은 재접속해도 다시 구독하지 않는다.
   */
  events?: boolean;
  /** 내 진행 세션이 있을 때만 emotes 채널을 구독한다 — 없으면 서버가 구독을 거절한다. */
  emote: boolean;
  onEvent: (body: unknown) => void;
  /** (재)연결됐다 — 호출부가 최신 스냅숏으로 재동기화한다. */
  onOpen: () => void;
  onError: (message: string) => void;
  /**
   * 이동 채널이 영구 거절됐다(STOMP ERROR, 오류 큐의 `NOT_A_MEMBER`) — `onError` 는 그 외 오류 큐 코드로도
   * 불리므로, 동기화를 끄는 판단은 이 콜백으로만 한다(`movement: true` 일 때만 불린다).
   */
  onMovementDenied?: () => void;
};

export function realtimeWsUrl(apiUrl: string = API_URL): string {
  return apiUrl.replace(/^http/, 'ws') + '/ws/realtime';
}

/**
 * `/user/queue/errors`·STOMP ERROR가 실어 보내는 원시 문구를 화면에 띄울 문구로 바꾼다.
 * `NOT_FOCUSING`은 내 세션이 이미 끝난 뒤(강퇴 등) 남아 있던 응원 구독 재연결이 뒤늦게
 * 거절될 때 오는 기대된 잡음이라 토스트를 띄우지 않는다 — 세션 종료는 이미 별도 안내로 뜬다.
 * 그 외 알려지지 않은 `LIKE_THIS` 형태의 원시 코드도 코드 그대로 보여주지 않고 기본 문구로 대신한다.
 */
export function friendlyRealtimeErrorMessage(raw: string): string | null {
  if (raw === 'NOT_FOCUSING') return null;
  if (raw === 'NO_ONE_FOCUSING') return t('focusFlow.hud.emoteNoOneFocusing');
  if (/^[A-Z][A-Z0-9_]*$/.test(raw)) return '실시간 요청이 거절됐어요.';
  return raw;
}

/** 실시간 STOMP 클라이언트 공용 설정(재접속·하트비트·인증) — 바다 방(seaRealtime, GROMO-2310)도 같은 값으로 연다. */
export const realtimeClientOptions = () => ({
  brokerURL: realtimeWsUrl(),
  reconnectDelay: 5000,
  heartbeatIncoming: 10_000,
  heartbeatOutgoing: 10_000,
  // [진단] React Native WebSocket 은 문자열 프레임의 NULL(\0)을 잘라 STOMP 프레임 끝이 사라진다.
  forceBinaryWSFrames: true,
  appendMissingNULLonIncoming: true,
  beforeConnect: (c: Client) => {
    const token = getAccessToken();
    if (token) c.connectHeaders = { Authorization: `Bearer ${token}` };
  },
});

/**
 * 이동 채널 STOMP ERROR 코드 중 영구 차단 대상 — 그 외(일시 상류 장애·시도 창 초과 등)는 재접속에서 다시 구독한다.
 * INVALID_REQUEST 는 같은 요청이면 항상 같은 거절이라 재시도로도 풀리지 않는다 — 영구 차단.
 */
const PERMANENT_MOVEMENT_DENY = new Set([
  'NOT_A_MEMBER',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INVALID_REQUEST',
]);
/** 일시 오류가 이 횟수만큼 쌓이면 그때부터 영구 차단한다 — 무한 재접속·재거절 루프 방지. */
const MOVEMENT_TRANSIENT_ERROR_LIMIT = 3;

export function stompIslandChannel(opts: IslandChannelOpts): IslandChannel {
  const id = encodeURIComponent(opts.islandId);
  const emitError = (raw: string) => {
    const mapped = friendlyRealtimeErrorMessage(raw);
    if (mapped !== null) opts.onError(mapped);
  };
  // 구독 거절 ERROR 는 연결을 끊는다 — emotes 구독 거절이면 다음 접속부터는 빼서 무한 거절 루프를 끊는다.
  let emoteDenied = false;
  let emoteEnabled = opts.emote;
  let emoteSubscription: { unsubscribe(): void } | null = null;
  // 이동 구독이 거절되면 서버가 소켓을 닫고 stompjs 가 5초마다 재접속·재거절한다 — 같은 방식으로 끊는다.
  let eventsDenied = false;
  let movementDenied = false;
  let movementTransientErrors = 0;
  // 코덱스 지적(에픽 PR #1111 4라운드): 첫 ERROR 뒤 소켓이 닫히기 전 같은 접속의 둘째 구독이 600ms 시도
  // 창에 걸려 ERROR 를 한 번 더 낼 수 있다 — 접속당 1회만 센다. onConnect 에서 false 로 리셋.
  let movementErrorCountedSinceConnect = false;
  const onMsg = (msg: IMessage) => {
    try {
      opts.onEvent(JSON.parse(msg.body));
    } catch {
      // 깨진 프레임은 무시한다.
    }
  };
  // 이동 토픽의 첫 정상 메시지(FullState 포함)를 받으면 연속 실패가 끊긴 것 — 일시 오류 카운터를 되돌린다.
  // onConnect(구독 송신)는 성공 신호가 아니므로 여기서만 리셋한다(리뷰어 지적).
  const onMovementMsg = (msg: IMessage) => {
    movementTransientErrors = 0;
    onMsg(msg);
  };
  const client = new Client({
    ...realtimeClientOptions(),
    onConnect: () => {
      emoteSubscription = null;
      movementErrorCountedSinceConnect = false;
      if (opts.presence !== false) {
        client.subscribe(`/topic/islands/${id}/focus`, onMsg);
        client.subscribe(`/topic/islands/${id}/rest`, onMsg);
      }
      if (opts.movement && !movementDenied) {
        client.subscribe(`/topic/islands/${id}/movement`, onMovementMsg);
        client.subscribe(`/topic/islands/${id}/movement/snapshot`, onMovementMsg);
      }
      if (opts.playback) client.subscribe(`/topic/islands/${id}/playback`, onMsg);
      if (opts.events && !eventsDenied) client.subscribe(`/topic/islands/${id}/events`, onMsg);
      client.subscribe('/user/queue/errors', (msg: IMessage) => {
        let text = '실시간 요청이 거절됐어요.';
        try {
          const b = JSON.parse(msg.body) as { code?: unknown; message?: unknown };
          if (typeof b?.message === 'string' && b.message) text = b.message;
          // 서버 오류 봉투는 code 와 message 를 따로 싣는다 — 코드로 기대된 잡음을 거른다.
          if (b?.code === 'NOT_FOCUSING') text = 'NOT_FOCUSING';
          // 이동 의도가 멤버 아님으로 거절됐다 — 이 채널은 다시 구독하지 않는다. 호출부는 조용히 로컬로 폴백한다.
          if (b?.code === 'NOT_A_MEMBER' && opts.movement) {
            movementDenied = true;
            opts.onMovementDenied?.();
          }
        } catch {
          // 기본 문구로 둔다.
        }
        emitError(text);
      });
      if (emoteEnabled && !emoteDenied)
        emoteSubscription = client.subscribe(`/topic/islands/${id}/emotes`, onMsg);
      opts.onOpen();
    },
    onStompError: (frame: IFrame) => {
      // 구독이 둘 이상인 접속(이동·응원 + 주민 소식)의 첫 ERROR 는 새로 붙인 events 구독 탓으로 보고 events 만 끈다 —
      // 응원·이동 등 다른 채널의 거절 상태는 건드리지 않는다. 그쪽 거절이 진짜라면 재접속 뒤 다음 ERROR 에서 평소대로 판정된다.
      const eventsFault = !!opts.events && !eventsDenied;
      if (opts.events) eventsDenied = true;
      if (emoteEnabled && !eventsFault) emoteDenied = true;
      if (opts.movement && !eventsFault) {
        let code = str(frame.headers.message) ?? '';
        if (!code) {
          try {
            code = str((JSON.parse(frame.body) as { code?: unknown }).code) ?? '';
          } catch {
            // 본문도 JSON 이 아니면 빈 코드로 둔다.
          }
        }
        // 코덱스 지적(에픽 PR #1111): 서버 관문은 일시 상류 장애·시도 창 초과(MOVEMENT_TOO_FREQUENT)에도
        // ERROR 프레임을 보낸다 — 멤버 아님·인증 오류만 영구 차단하고, 그 외는 재접속에서 다시 구독하게
        // 두되 상한(3)에 닿으면 그때 차단해 무한 재접속·재거절 루프를 막는다.
        if (PERMANENT_MOVEMENT_DENY.has(code)) {
          movementDenied = true;
          opts.onMovementDenied?.();
        } else if (!movementErrorCountedSinceConnect) {
          // 같은 접속에서 온 둘째 ERROR(위 600ms 시도 창 중복)는 다시 세지 않는다.
          movementErrorCountedSinceConnect = true;
          movementTransientErrors += 1;
          if (movementTransientErrors >= MOVEMENT_TRANSIENT_ERROR_LIMIT) {
            movementDenied = true;
            opts.onMovementDenied?.();
          }
        }
      }
      emitError(frame.headers.message ?? '실시간 연결이 거절됐어요.');
    },
  });
  client.activate();
  return {
    send: (destination, body) => {
      if (!client.connected) return false;
      client.publish({ destination, body: JSON.stringify(body) });
      return true;
    },
    setEmoteEnabled: (enabled) => {
      if (enabled) emoteDenied = false;
      emoteEnabled = enabled;
      if (!enabled) {
        if (client.connected) emoteSubscription?.unsubscribe();
        emoteSubscription = null;
      } else if (client.connected && !emoteDenied && !emoteSubscription) {
        emoteSubscription = client.subscribe(`/topic/islands/${id}/emotes`, onMsg);
      }
    },
    reopen: () => {
      void client.deactivate().then(() => client.activate());
    },
    close: () => {
      void client.deactivate();
    },
  };
}

/**
 * `SEND /app/islands/{islandId}/movement/intent` (GROMO-2248). 미연결이면 false.
 * islandId 는 인코딩하지 않는다 — 서버가 소문자 UUID 36자 그대로만 받는다(응원 send 와 같다).
 */
export function publishMoveIntent(
  channel: IslandChannel,
  islandId: string,
  intent: MoveIntent,
): boolean {
  return channel.send(`/app/islands/${islandId}/movement/intent`, intent);
}

export type IslandRealtime = {
  /** 최신 스냅숏으로 다시 맞춘다 — 포그라운드 복귀·재연결·수동 재시도에서 부른다. */
  resync(source?: 'reconnect' | 'manual'): void;
  /** 소켓과 구독을 버리고 다시 연다. */
  reopen(): void;
  /** `SEND /app/islands/{id}/focus/emotes`. 세션 없음·미연결·미지 타입이면 false. */
  sendEmote(type: string): boolean;
  /** presence 소켓을 재연결하지 않고 응원 자격과 구독만 갱신한다. */
  setEmoteSessionId(sessionId: string | null): void;
  dispose(): void;
};

export type IslandRealtimeDeps = {
  islandId: string;
  /** 응원 구독·발신 자격이 되는 내 진행 중 서버 세션 id. 없으면 emotes 채널을 구독하지 않는다. */
  emoteSessionId?: string | null;
  /** 방문자 모드(GROMO-2259) — 세션 없이도 emotes 를 구독하고 `{ type }` 만 보낸다. */
  visitor?: boolean;
  /** 주민 소식 구독(GROMO-2311) — 현재 소속 섬의 주민 화면에서만 켠다. */
  events?: boolean;
  /** 다른 주민이 이 섬에 처음 도착했다(내 도착 제외·중복 제거 후 1번). */
  onMemberArrived?: (event: MemberArrivedEvent) => void;
  /** 방문자가 보낸 응원을 받았다(주민 화면). eventId 로 중복 제거된 뒤 1번만 불린다. */
  onVisitorEmote?: (emote: LiveEmote) => void;
  onView: (view: PresenceView) => void;
  /** 검증된 포커스/휴식 상태 경계 변화. 새 화면 상태를 발행한 뒤 호출한다. */
  onTransition?: (transition: IslandPresenceTransition) => void;
  /** 서버가 확정해 섬 focus 채널로 보낸 황금 물고기 사건. */
  onGoldenFish?: (event: GoldenFishEvent) => void;
  /** 비동기 거절 통지 — `/user/queue/errors`, STOMP ERROR 프레임. */
  onSendError?: (message: string) => void;
  /** 세대 fence — false가 되면 늦은 이벤트·응답을 버린다. */
  alive?: () => boolean;
  connect?: (opts: IslandChannelOpts) => IslandChannel;
  loadSnapshots?: (islandId: string) => Promise<{
    focus: MembersSnapshot<FocusMember>;
    rest: MembersSnapshot<RestMember>;
  }>;
};

const defaultSnapshots = (islandId: string) =>
  Promise.all([focusMembers(islandId), restMembers(islandId)]).then(([focus, rest]) => ({
    focus,
    rest,
  }));

export function startIslandRealtime(deps: IslandRealtimeDeps): IslandRealtime {
  const { islandId } = deps;
  let emoteSessionId = deps.emoteSessionId ?? null;
  const load = deps.loadSnapshots ?? defaultSnapshots;
  const connect = deps.connect ?? stompIslandChannel;
  const alive = deps.alive ?? (() => true);
  const arrivalFilter = memberArrivalFilter(islandId, sessionSelfId);
  const projection = new IslandProjection(islandId);
  projection.onVisitorEmote = (emote) => {
    if (!disposed && alive()) deps.onVisitorEmote?.(emote);
  };
  let disposed = false;
  let resyncing = false;
  let resyncAfter: 'reconnect' | 'manual' | 'event-gap' | null = null;
  let eventGapRetries = 0;
  let hadData = false;
  let snapshotVersion = 0;
  const pendingEvents: { raw: unknown; misses: number }[] = [];
  const seenGolden = new Set<string>();
  const goldenQueue: string[] = [];
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let gapRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let gapRetryDelay = 250;

  const publish = (
    status: PresenceView['status'],
    error: ApiError | null = null,
    snapshotTransitions: IslandPresenceTransition[] = [],
  ) => {
    if (disposed || !alive()) return;
    deps.onView({
      status,
      error,
      focus: projection.focus(),
      rest: projection.rest(),
      emotes: projection.emotes(),
      clockOffset: projection.clockOffset,
      snapshotVersion,
      snapshotTransitions,
    });
  };

  const scheduleExpiry = () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    const next = projection.sweepEmotes();
    if (next !== null) {
      expiryTimer = setTimeout(
        () => publish('ready'),
        Math.max(0, next - projection.serverNowMs()) + 20,
      );
    }
  };

  const replayPendingEvents = (confirmedSnapshot = true) => {
    let changed = false;
    const transitions: IslandPresenceTransition[] = [];
    const pending = pendingEvents.splice(0);
    for (const entry of pending) {
      const previouslyNeeded = projection.resyncNeeded;
      projection.resyncNeeded = false;
      const result = projection.applyWithTransition(entry.raw);
      const unresolved = projection.resyncNeeded;
      // 첫 정본 조회에도 없는 이벤트만 한 번 더 확인한다. 두 번째 정본에도 없으면
      // 완료 후 지연 도착한 사건으로 보고 폐기해 event-gap GET이 영구 반복되지 않게 한다.
      const retry = unresolved && (!confirmedSnapshot || entry.misses < 1);
      projection.resyncNeeded = previouslyNeeded || retry;
      if (retry)
        pendingEvents.push({
          raw: entry.raw,
          misses: confirmedSnapshot ? entry.misses + 1 : entry.misses,
        });
      changed ||= result.changed;
      if (result.transition) transitions.push(result.transition);
    }
    scheduleExpiry();
    return { changed, transitions, processed: pending.length > 0, entries: pending };
  };

  const recoverSnapshotTransitions = (
    transitions: IslandPresenceTransition[],
    entries: { raw: unknown; misses: number }[],
    previousFocus: Map<string, LiveFocusMember>,
    previousRest: Map<string, LiveRestMember>,
  ): IslandPresenceTransition[] => {
    const recovered = [...transitions];
    const covered = new Set(
      transitions.map((transition) => `${transition.kind}:${transition.userId}`),
    );
    for (const { raw } of entries) {
      const env = raw as RealtimeEnvelope;
      if (!env || env.schemaVersion !== 1 || env.islandId !== islandId) continue;
      const p = env.payload as Record<string, unknown> | null;
      const userId = str(p?.userId);
      if (!userId) continue;
      if (env.type === 'focus.member.updated' && !covered.has(`focus:${userId}`)) {
        const previous = previousFocus.get(userId) ?? null;
        const current = projection.focus().find((member) => member.userId === userId) ?? null;
        if (previous?.status !== current?.status || previous?.sessionId !== current?.sessionId) {
          recovered.push({ source: 'event', kind: 'focus', userId, previous, current });
          covered.add(`focus:${userId}`);
        }
      } else if (env.type === 'rest.member.updated' && !covered.has(`rest:${userId}`)) {
        const previous = previousRest.get(userId) ?? null;
        const current = projection.rest().find((member) => member.userId === userId) ?? null;
        if (!!previous !== !!current) {
          recovered.push({ source: 'event', kind: 'rest', userId, previous, current });
          covered.add(`rest:${userId}`);
        }
      }
    }
    return recovered;
  };

  const clearGapRetry = () => {
    if (gapRetryTimer) clearTimeout(gapRetryTimer);
    gapRetryTimer = null;
  };

  const scheduleGapRetry = (retry: () => void) => {
    if (gapRetryTimer) return;
    const delay = gapRetryDelay;
    gapRetryDelay = Math.min(gapRetryDelay * 2, 5000);
    gapRetryTimer = setTimeout(() => {
      gapRetryTimer = null;
      eventGapRetries = 0;
      retry();
    }, delay);
  };

  const resync = async (source: 'reconnect' | 'manual' | 'event-gap' = 'manual') => {
    if (disposed || !alive()) return;
    if (resyncing) {
      // event-gap 원인이 대기열에서 사라지면 확인된 이벤트 전이가 유실되므로 우선 보존한다.
      if (source === 'event-gap' || resyncAfter === null) resyncAfter = source;
      return;
    }
    resyncing = true;
    if (source !== 'event-gap') {
      eventGapRetries = 0;
      gapRetryDelay = 250;
      clearGapRetry();
    }
    if (!hadData) publish('loading');
    const hadPreviousSnapshot = hadData;
    const previousFocus = new Map(projection.focus().map((m) => [m.userId, m]));
    const previousRest = new Map(projection.rest().map((m) => [m.userId, m]));
    try {
      const { focus, rest } = await load(islandId);
      if (disposed || !alive()) return;
      projection.loadFocus(focus);
      projection.loadRest(rest);
      projection.resyncNeeded = false;
      const replay = replayPendingEvents();
      const transitions =
        source === 'event-gap' || !hadPreviousSnapshot
          ? replay.transitions
          : recoverSnapshotTransitions(
              replay.transitions,
              replay.entries,
              previousFocus,
              previousRest,
            );
      // 프로젝션 전파 지연은 한 번 더 확인하되, 미반영 이벤트를 보존해 무한 즉시 재조회는 막는다.
      if (projection.resyncNeeded && eventGapRetries < 1) {
        eventGapRetries += 1;
        resyncAfter = 'event-gap';
      } else if (projection.resyncNeeded) scheduleGapRetry(() => void resync('event-gap'));
      else {
        eventGapRetries = 0;
        gapRetryDelay = 250;
        clearGapRetry();
      }
      hadData = true;
      if (source !== 'event-gap') snapshotVersion = ++nextSnapshotVersion;
      publish('ready', null, source !== 'event-gap' ? transitions : []);
      if (source !== 'event-gap') {
        for (const transition of transitions) deps.onTransition?.(transition);
      }
      if (source === 'event-gap') {
        const transitions: IslandPresenceTransition[] = [];
        const nextFocus = new Map(projection.focus().map((m) => [m.userId, m]));
        for (const userId of new Set([...previousFocus.keys(), ...nextFocus.keys()])) {
          const previous = previousFocus.get(userId) ?? null;
          const current = nextFocus.get(userId) ?? null;
          if (previous?.status !== current?.status || previous?.sessionId !== current?.sessionId) {
            transitions.push({ source, kind: 'focus', userId, previous, current });
          }
        }
        const nextRest = new Map(projection.rest().map((m) => [m.userId, m]));
        for (const userId of new Set([...previousRest.keys(), ...nextRest.keys()])) {
          const previous = previousRest.get(userId) ?? null;
          const current = nextRest.get(userId) ?? null;
          if (!!previous !== !!current)
            transitions.push({ source, kind: 'rest', userId, previous, current });
        }
        for (const transition of transitions) {
          if (disposed || !alive()) break;
          deps.onTransition?.(transition);
        }
      }
    } catch (thrown) {
      if (disposed || !alive()) return;
      // 첫 스냅숏 실패만 화면 오류로 올린다 — 이미 데이터가 있으면 재연결 때 다시 맞춘다.
      if (!hadData) publish('error', thrown as ApiError);
      else {
        // 재연결 조회가 실패해도 그 사이 도착한 이벤트는 마지막 정상 스냅숏 위에 반영한다.
        // 실패한 GET은 정본 확인 횟수로 세지 않는다. 마지막 정상 스냅숏에 적용 가능한
        // 이벤트만 반영하고, 모르는 주민 이벤트는 같은 misses로 다음 성공 조회까지 보존한다.
        const replay = replayPendingEvents(false);
        if (replay.processed && projection.resyncNeeded && eventGapRetries < 1) {
          eventGapRetries += 1;
          resyncAfter = 'event-gap';
        } else if (replay.processed && projection.resyncNeeded)
          scheduleGapRetry(() => void resync('event-gap'));
        if (replay.changed) {
          publish('ready');
          for (const transition of replay.transitions) deps.onTransition?.(transition);
        }
      }
    } finally {
      resyncing = false;
      if (resyncAfter !== null) {
        const nextSource = resyncAfter;
        resyncAfter = null;
        void resync(nextSource);
      }
    }
  };

  const conn = connect({
    islandId,
    emote: !!emoteSessionId || !!deps.visitor,
    events: deps.events,
    onEvent: (raw) => {
      if (disposed || !alive()) return;
      if ((raw as RealtimeEnvelope | null)?.type === 'island.member.arrived') {
        const arrived = arrivalFilter(raw);
        if (arrived) deps.onMemberArrived?.(arrived);
        return;
      }
      const golden = parseGoldenFishEvent(raw, islandId);
      if (golden) {
        if (seenGolden.has(golden.eventId)) return;
        seenGolden.add(golden.eventId);
        goldenQueue.push(golden.eventId);
        if (goldenQueue.length > 200) seenGolden.delete(goldenQueue.shift()!);
        deps.onGoldenFish?.(golden);
        return;
      }
      if (resyncing) {
        // 응원은 순간 사건이라 스냅숏/replay 대상이 아니다. 재연결 중 받은 응원은
        // 뒤늦게 재생하지 않고, 상태형 주민 이벤트만 정본 위에 replay한다.
        const type = (raw as RealtimeEnvelope | null)?.type;
        if (type === 'focus.member.updated' || type === 'rest.member.updated')
          pendingEvents.push({ raw, misses: 0 });
        return;
      }
      const previouslyNeeded = projection.resyncNeeded;
      projection.resyncNeeded = false;
      const result = projection.applyWithTransition(raw);
      const unresolved = projection.resyncNeeded;
      projection.resyncNeeded = previouslyNeeded || unresolved;
      if (unresolved) pendingEvents.push({ raw, misses: 0 });
      if (projection.resyncNeeded) void resync('event-gap');
      if (result.changed) {
        scheduleExpiry();
        publish('ready');
        if (result.transition && !disposed && alive()) deps.onTransition?.(result.transition);
      }
    },
    onOpen: () => void resync('reconnect'),
    onError: (message) => {
      if (!disposed && alive()) deps.onSendError?.(message);
    },
  });

  return {
    resync: (source) => void resync(source ?? 'manual'),
    reopen: () => conn.reopen(),
    sendEmote: (type) => {
      const sessionId = emoteSessionId;
      if (!EMOTE_TYPES.has(type)) return false;
      if (!sessionId && !deps.visitor) return false;
      return conn.send(
        `/app/islands/${islandId}/focus/emotes`,
        sessionId ? { sessionId, type } : { type },
      );
    },
    setEmoteSessionId: (sessionId) => {
      emoteSessionId = sessionId;
      conn.setEmoteEnabled(!!sessionId || !!deps.visitor);
    },
    dispose: () => {
      disposed = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      clearGapRetry();
      conn.close();
    },
  };
}
