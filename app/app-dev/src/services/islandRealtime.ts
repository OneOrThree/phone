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
 */
import { Client, type IFrame, type IMessage } from '@stomp/stompjs';
import { API_URL, ApiError } from '@/services/api/client';
import { getAccessToken } from '@/services/api/session';
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
export type LiveEmote = { eventId: string; userId: string; type: string; expiresAtMs: number };

export type IslandPresenceTransition =
  | {
      source: 'event' | 'event-gap';
      kind: 'focus';
      userId: string;
      previous: LiveFocusMember | null;
      current: LiveFocusMember | null;
    }
  | {
      source: 'event' | 'event-gap';
      kind: 'rest';
      userId: string;
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
            ? { source: 'event', kind, userId, previous: prev!, current: null }
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
          prev?.status !== current.status
            ? { source: 'event', kind, userId, previous: prev ?? null, current }
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
        transition: prev ? null : { source: 'event', kind, userId, previous: null, current },
      };
    }
    const prev = this.restMap.get(userId);
    const changed = this.restMap.delete(userId);
    return {
      changed,
      transition: changed
        ? { source: 'event', kind, userId, previous: prev!, current: null }
        : null,
    };
  }

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
};

export const EMPTY_PRESENCE: PresenceView = {
  status: 'loading',
  error: null,
  focus: [],
  rest: [],
  emotes: [],
  clockOffset: 0,
  snapshotVersion: 0,
};

let nextSnapshotVersion = 0;

/** 섬 단위 STOMP 채널 — 구독 수명은 채널과 같고 끊기면 서버가 구독을 다 버린다. */
export type IslandChannel = {
  send(destination: string, body: unknown): boolean;
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
  /** 내 진행 세션이 있을 때만 emotes 채널을 구독한다 — 없으면 서버가 구독을 거절한다. */
  emote: boolean;
  onEvent: (body: unknown) => void;
  /** (재)연결됐다 — 호출부가 최신 스냅숏으로 재동기화한다. */
  onOpen: () => void;
  onError: (message: string) => void;
};

export function realtimeWsUrl(apiUrl: string = API_URL): string {
  return apiUrl.replace(/^http/, 'ws') + '/ws/realtime';
}

export function stompIslandChannel(opts: IslandChannelOpts): IslandChannel {
  const id = encodeURIComponent(opts.islandId);
  // 구독 거절 ERROR 는 연결을 끊는다 — emotes 구독 거절이면 다음 접속부터는 빼서 무한 거절 루프를 끊는다.
  let emoteDenied = false;
  const client = new Client({
    brokerURL: realtimeWsUrl(),
    reconnectDelay: 5000,
    heartbeatIncoming: 10_000,
    heartbeatOutgoing: 10_000,
    beforeConnect: (c) => {
      const token = getAccessToken();
      if (token) c.connectHeaders = { Authorization: `Bearer ${token}` };
    },
    onConnect: () => {
      const onMsg = (msg: IMessage) => {
        try {
          opts.onEvent(JSON.parse(msg.body));
        } catch {
          // 깨진 프레임은 무시한다.
        }
      };
      if (opts.presence !== false) {
        client.subscribe(`/topic/islands/${id}/focus`, onMsg);
        client.subscribe(`/topic/islands/${id}/rest`, onMsg);
      }
      if (opts.playback) client.subscribe(`/topic/islands/${id}/playback`, onMsg);
      client.subscribe('/user/queue/errors', (msg: IMessage) => {
        let text = '실시간 요청이 거절됐어요.';
        try {
          const b = JSON.parse(msg.body) as { message?: unknown };
          if (typeof b?.message === 'string' && b.message) text = b.message;
        } catch {
          // 기본 문구로 둔다.
        }
        opts.onError(text);
      });
      if (opts.emote && !emoteDenied) client.subscribe(`/topic/islands/${id}/emotes`, onMsg);
      opts.onOpen();
    },
    onStompError: (frame: IFrame) => {
      if (opts.emote) emoteDenied = true;
      opts.onError(frame.headers.message ?? '실시간 연결이 거절됐어요.');
    },
  });
  client.activate();
  return {
    send: (destination, body) => {
      if (!client.connected) return false;
      client.publish({ destination, body: JSON.stringify(body) });
      return true;
    },
    reopen: () => {
      void client.deactivate().then(() => client.activate());
    },
    close: () => {
      void client.deactivate();
    },
  };
}

export type IslandRealtime = {
  /** 최신 스냅숏으로 다시 맞춘다 — 포그라운드 복귀·재연결·수동 재시도에서 부른다. */
  resync(source?: 'reconnect' | 'manual'): void;
  /** 소켓과 구독을 버리고 다시 연다. */
  reopen(): void;
  /** `SEND /app/islands/{id}/focus/emotes`. 세션 없음·미연결·미지 타입이면 false. */
  sendEmote(type: string): boolean;
  dispose(): void;
};

export type IslandRealtimeDeps = {
  islandId: string;
  /** 응원 구독·발신 자격이 되는 내 진행 중 서버 세션 id. 없으면 emotes 채널을 구독하지 않는다. */
  emoteSessionId?: string | null;
  onView: (view: PresenceView) => void;
  /** 검증된 포커스/휴식 상태 경계 변화. 새 화면 상태를 발행한 뒤 호출한다. */
  onTransition?: (transition: IslandPresenceTransition) => void;
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
  const load = deps.loadSnapshots ?? defaultSnapshots;
  const connect = deps.connect ?? stompIslandChannel;
  const alive = deps.alive ?? (() => true);
  const projection = new IslandProjection(islandId);
  let disposed = false;
  let resyncing = false;
  let resyncAfter: 'reconnect' | 'manual' | 'event-gap' | null = null;
  let hadData = false;
  let snapshotVersion = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;

  const publish = (status: PresenceView['status'], error: ApiError | null = null) => {
    if (disposed || !alive()) return;
    deps.onView({
      status,
      error,
      focus: projection.focus(),
      rest: projection.rest(),
      emotes: projection.emotes(),
      clockOffset: projection.clockOffset,
      snapshotVersion,
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

  const resync = async (source: 'reconnect' | 'manual' | 'event-gap' = 'manual') => {
    if (disposed || !alive()) return;
    if (resyncing) {
      // event-gap 원인이 대기열에서 사라지면 확인된 이벤트 전이가 유실되므로 우선 보존한다.
      if (source === 'event-gap' || resyncAfter === null) resyncAfter = source;
      return;
    }
    resyncing = true;
    if (!hadData) publish('loading');
    try {
      const { focus, rest } = await load(islandId);
      if (disposed || !alive()) return;
      const previousFocus =
        source === 'event-gap' ? new Map(projection.focus().map((m) => [m.userId, m])) : null;
      const previousRest =
        source === 'event-gap' ? new Map(projection.rest().map((m) => [m.userId, m])) : null;
      projection.loadFocus(focus);
      projection.loadRest(rest);
      projection.resyncNeeded = false;
      hadData = true;
      if (source !== 'event-gap') snapshotVersion = ++nextSnapshotVersion;
      publish('ready');
      if (source === 'event-gap') {
        const transitions: IslandPresenceTransition[] = [];
        const nextFocus = new Map(projection.focus().map((m) => [m.userId, m]));
        for (const userId of new Set([...(previousFocus?.keys() ?? []), ...nextFocus.keys()])) {
          const previous = previousFocus?.get(userId) ?? null;
          const current = nextFocus.get(userId) ?? null;
          if (previous?.status !== current?.status) {
            transitions.push({ source, kind: 'focus', userId, previous, current });
          }
        }
        const nextRest = new Map(projection.rest().map((m) => [m.userId, m]));
        for (const userId of new Set([...(previousRest?.keys() ?? []), ...nextRest.keys()])) {
          const previous = previousRest?.get(userId) ?? null;
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
    emote: !!deps.emoteSessionId,
    onEvent: (raw) => {
      if (disposed || !alive()) return;
      const result = projection.applyWithTransition(raw);
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
      const sessionId = deps.emoteSessionId;
      if (!sessionId || !EMOTE_TYPES.has(type)) return false;
      return conn.send(`/app/islands/${islandId}/focus/emotes`, { sessionId, type });
    },
    dispose: () => {
      disposed = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      conn.close();
    },
  };
}
