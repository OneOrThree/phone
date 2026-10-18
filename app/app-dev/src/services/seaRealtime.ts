/**
 * 먼바다 방 실시간 클라이언트(GROMO-2310). 서버 계약 정본은 `server/realtime/CLAUDE.md` 「API surface」의 바다 행과
 * 「바다 앱 프레임 순서(강제)」·「바다 앱 계약 보충」이다.
 *
 * 프레임 순서(서버가 강제): `SUB /user/queue/sea` → `SEND /app/sea/enter {}` → `sea.room.assigned{roomId}` →
 * `SUB /topic/sea/rooms/{roomId}` → `SEND /app/sea/sync {}` → `sea.room.snapshot{roomId, members[]}`.
 * 방을 구독한 «뒤»에 스냅샷을 받으므로 그 사이 입퇴장을 놓치지 않는다. 소속 전 방 SUB 는 ERROR + 소켓 종료다.
 *
 * - (재)연결하면 구독이 모두 사라졌으므로 **항상 `enter` 부터** 다시 한다(방이 남아 있으면 같은 방의 assigned 가 온다).
 * - 45초마다 `sync`(방이 없으면 `enter`) — Redis 장애·flush 뒤 서버가 먼저 알릴 수 없는 조용한 구간의 상한(서버 결정 N39).
 *   `NOT_IN_SEA_ROOM`(오류 큐)이면 다시 `enter` 한다.
 * - `sea.room.left` 는 그 사용자의 모든 세션에 오고 중복될 수 있다 — `eventId` 로 한 번만 처리한다(멱등).
 * - 서버 스위치 `FOCUS_SEA_REALTIME_EVENTS_ENABLED` 가 꺼진 환경(dev 기본)에서는 남의 출항·종료·한마디 변경이 다음
 *   enter/sync 스냅샷 전까지 보이지 않는다. 내 항해 화면은 HTTP 응답(세션·한마디)으로 직접 그리므로 영향이 없다.
 */
import { Client, type IFrame, type IMessage } from '@stomp/stompjs';
import { t } from '@/i18n';
import { colors, type Color } from '@/services/model';
import { EMOTE_TYPES, friendlyRealtimeErrorMessage, realtimeClientOptions } from './islandRealtime';
import type { SeaEmote, SeaParticipant } from '@/screens/sea/seaModel';

/** 주기 sync 간격 — 서버 권장 30~60초의 가운데. */
export const SEA_SYNC_MS = 45_000;
/** 서버 시도 창(600ms)을 넘기면 ERROR + 연결 종료라 앱이 먼저 거른다. */
const EMOTE_TRY_MS = 700;
const ENTER_TRY_MS = 1_000;
/** 연속 ERROR 프레임(연결 종료) 상한 — 닿으면 stompjs 의 5초 재접속을 멈추고 아래 백오프로만 다시 붙는다. 스냅샷을 받으면 0 으로. */
const STOMP_ERROR_LIMIT = 3;
/** 상한에 닿은 뒤 다시 붙어 볼 간격 — 일시 장애(UPSTREAM_UNAVAILABLE 등)가 풀리면 화면을 다시 열지 않아도 돌아온다. */
const SEA_RECONNECT_BACKOFF_MS = [30_000, 60_000, 120_000];

/** 표시 모델 + 기준 시각(받은 시각, 기기 시계 ms). 집중 중이면 여기서부터 경과를 더해 그린다. */
export type SeaLiveMember = SeaParticipant & {
  anchorMs: number;
  /** 서버 `member.session.sessionId` — 내 항해가 로컬 세션과 같은지 가른다(2303 표시 모델에는 넣지 않는다). */
  sessionId?: string;
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * 서버 `member` → 표시 모델. `name`·`catColor` 는 서버가 싣지만(2330) 보강 전 기록된 옛 해시엔 null 이라 `'???'`·`'gray'` 로 폴백한다.
 * `activeSeconds` 는 서버 발행 시각 기준값이라 받은 시각을 기준점으로 삼는다(기기·서버 시계 차이를 타지 않는다).
 */
export function seaMemberFromWire(raw: unknown, receivedAt: number): SeaLiveMember | null {
  const m = raw as Record<string, unknown> | null;
  const userId = str(m?.userId);
  if (!m || !userId) return null;
  const session = m.session as Record<string, unknown> | null | undefined;
  const color = colors.includes(m.catColor as Color) ? (m.catColor as Color) : 'gray';
  const remark = str(m.remark);
  const sessionId = str(session?.sessionId);
  return {
    userId,
    name: str(m.name) ?? '???',
    color,
    focusing: m.state === 'focusing',
    activeSeconds: Math.max(0, num(session?.activeSeconds) ?? 0),
    anchorMs: receivedAt,
    ...(sessionId ? { sessionId } : {}),
    ...(remark ? { message: remark } : {}),
  };
}

/** 지금 시각의 참가자 목록 — 집중 중이면 받은 뒤 흐른 초를 더한다(표류 중이면 서버가 멈춘 값 그대로). */
export function seaParticipantsAt(members: readonly SeaLiveMember[], now: number) {
  return members.map(({ anchorMs, sessionId: _sessionId, ...m }): SeaParticipant =>
    m.focusing
      ? { ...m, activeSeconds: m.activeSeconds + Math.max(0, Math.floor((now - anchorMs) / 1000)) }
      : m,
  );
}

export type SeaRoomOpts = {
  /** 방 구성원이 바뀔 때마다 전체 목록(나 포함)을 준다. */
  onMembers: (members: SeaLiveMember[]) => void;
  /** 방 이모트 — 내 것도 온다(그것이 발신 성공 ack). */
  onEmote: (userId: string, type: SeaEmote) => void;
  onError: (message: string) => void;
  /** 내가 방에서 빠졌다(`sea.room.left`). `adrift`(10분 정리)면 다음 재연결 전까지 다시 들어가지 않는다. */
  onLeft?: (reason: string) => void;
  /** 끊겼다가 다시 연결됐다(첫 연결은 제외) — 그동안 놓친 세션 변화를 호출부가 HTTP 정본으로 맞춘다. */
  onReconnect?: () => void;
  now?: () => number;
};

export type SeaRoom = {
  /** `SEND /app/sea/rooms/{roomId}/emotes {type}`. 미연결·방 없음·시도 창 안·모르는 타입이면 false. */
  sendEmote(type: SeaEmote): boolean;
  /** 오류 상한으로 쉬고 있으면 기다리지 않고 바로 다시 붙는다(포그라운드 복귀·사용자 재시도). 연결 중이면 아무 일도 없다. */
  reconnect(): void;
  /** `SEND /app/sea/leave` 뒤 소켓을 닫고 재접속 타이머도 멈춘다. */
  close(): void;
};

type Envelope = { eventId?: unknown; type?: unknown; roomId?: unknown; payload?: unknown };

export function openSeaRoom(opts: SeaRoomOpts): SeaRoom {
  const now = opts.now ?? Date.now;
  let roomId: string | null = null;
  let roomSub: { unsubscribe(): void } | null = null;
  let members = new Map<string, SeaLiveMember>();
  let parked = false;
  let lastEnter = -Infinity;
  let lastEmote = -Infinity;
  let stompErrors = 0;
  let connectedBefore = false;
  // 오류 상한으로 쉬는 중 — 백오프 타이머가 다시 붙인다. 안내는 쉬기 시작할 때 한 번만(스냅샷을 받으면 다시 켠다)
  let suspended = false;
  let backoffStep = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let limitNotified = false;
  let closed = false;
  const resume = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (closed || !suspended) return;
    suspended = false;
    // stompErrors 는 그대로 둔다 — 다시 붙자마자 또 거절되면 바로 다음(더 긴) 백오프로 쉰다
    client.activate();
  };
  const seenLeft = new Set<string>();
  const emit = () => opts.onMembers([...members.values()]);
  const send = (destination: string, body: unknown = {}) => {
    if (!client.connected) return false;
    client.publish({ destination, body: JSON.stringify(body) });
    return true;
  };
  const enter = () => {
    // close() 뒤에는 다시 들어가지 않는다 — 내 leave 의 left 가 DISCONNECT 처리보다 먼저 돌아오면 enter 가 나갈 수 있다
    if (closed || parked || now() - lastEnter < ENTER_TRY_MS) return;
    if (send('/app/sea/enter')) lastEnter = now();
  };
  const dropRoom = () => {
    roomId = null;
    roomSub = null;
    members = new Map();
    emit();
  };
  const parse = (msg: IMessage): Envelope | null => {
    try {
      const body = JSON.parse(msg.body) as Envelope;
      return body && typeof body === 'object' ? body : null;
    } catch {
      return null; // 깨진 프레임은 버린다
    }
  };
  const onRoomEvent = (msg: IMessage) => {
    if (closed) return;
    const ev = parse(msg);
    if (!ev || ev.roomId !== roomId) return; // 옛 방의 늦은 사건
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === 'sea.member.joined' || ev.type === 'sea.member.updated') {
      const member = seaMemberFromWire(p.member, now());
      if (!member) return;
      members.set(member.userId, member);
      emit();
    } else if (ev.type === 'sea.member.left') {
      // 없는 사람 제거는 멱등이다(joined 뒤 보정 left 와 겹칠 수 있다)
      if (typeof p.userId === 'string' && members.delete(p.userId)) emit();
    } else if (ev.type === 'sea.emote') {
      if (typeof p.userId === 'string' && EMOTE_TYPES.has(p.type as string))
        opts.onEmote(p.userId, p.type as SeaEmote);
    }
  };
  const onPersonal = (msg: IMessage) => {
    if (closed) return;
    const ev = parse(msg);
    if (!ev) return;
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === 'sea.room.assigned') {
      const next = str(p.roomId);
      if (!next) return;
      // 같은 방 재확인(구독이 살아 있음)이면 다시 구독하지 않는다 — 구독은 방마다 하나뿐이다
      if (next !== roomId || !roomSub) {
        // 다른 방으로 배정됐거나 구독이 없다 — 옛 방 구독을 풀고(서버에는 이미 없는 방이라 무해) 새 방을 구독한 «뒤» sync
        roomSub?.unsubscribe();
        roomId = next;
        members = new Map();
        roomSub = client.subscribe(`/topic/sea/rooms/${next}`, onRoomEvent);
      }
      send('/app/sea/sync');
    } else if (ev.type === 'sea.room.snapshot') {
      if (str(p.roomId) !== roomId || !Array.isArray(p.members)) return;
      const at = now();
      members = new Map();
      for (const raw of p.members) {
        const member = seaMemberFromWire(raw, at);
        if (member) members.set(member.userId, member);
      }
      stompErrors = 0;
      backoffStep = 0;
      limitNotified = false;
      emit();
    } else if (ev.type === 'sea.room.left') {
      const id = str(ev.eventId);
      if (id) {
        if (seenLeft.has(id)) return;
        seenLeft.add(id);
      }
      if (str(p.roomId) !== roomId) return; // 이미 처리했거나 옛 방 — 멱등
      const reason = str(p.reason) ?? 'left';
      // 서버는 소속만 지운다 — 구독은 우리가 푼다. 남겨 두면 같은 방에 재배정될 때 이중 구독이 돼
      // 서버 세션 레지스트리가 INVALID_REQUEST + 연결 종료를 낸다
      roomSub?.unsubscribe();
      dropRoom();
      opts.onLeft?.(reason);
      // 10분 표류 정리는 서버의 결정이라 다시 들어가지 않는다. 다른 기기의 퇴장(left·disconnected)은 이 화면이 아직 있으니 다시 들어간다
      if (reason === 'adrift') parked = true;
      else enter();
    }
  };
  const onErrors = (msg: IMessage) => {
    if (closed) return;
    let code = '';
    let message = '';
    try {
      const b = JSON.parse(msg.body) as { code?: unknown; message?: unknown };
      code = str(b?.code) ?? '';
      message = str(b?.message) ?? '';
    } catch {
      // 기본 문구로 둔다
    }
    if (code === 'NOT_IN_SEA_ROOM') {
      // 방이 사라졌다(Redis 장애·flush·정리) — 다시 배정받는다
      if (roomId) {
        roomSub?.unsubscribe();
        dropRoom();
      }
      enter();
      return;
    }
    // Data 상태 조회 실패 — 다음 주기 틱이 enter 를 다시 보낸다
    if (code === 'UPSTREAM_UNAVAILABLE') return;
    if (code === 'EMOTE_TOO_FREQUENT') return opts.onError(t('openSea.emoteTooFrequent'));
    const text = friendlyRealtimeErrorMessage(code || message);
    if (text) opts.onError(text);
  };
  const client = new Client({
    ...realtimeClientOptions(),
    onConnect: () => {
      // 재연결 — 구독이 모두 사라졌고 마지막 세션이었다면 서버는 이미 left{disconnected} 로 내보냈다. 항상 enter 부터
      roomId = null;
      roomSub = null;
      parked = false;
      lastEnter = -Infinity;
      client.subscribe('/user/queue/sea', onPersonal);
      client.subscribe('/user/queue/errors', onErrors);
      enter();
      if (connectedBefore) opts.onReconnect?.();
      connectedBefore = true;
    },
    onStompError: (frame: IFrame) => {
      // 서버가 ERROR 뒤 소켓을 닫는다 — stompjs 가 5초 뒤 재접속해 onConnect 가 enter 부터 다시 한다
      const code = str(frame.headers.message) ?? '';
      // 이모트 연타 거절은 방 연결의 이상이 아니다 — 백오프 카운트에 넣지 않는다(연타 3번에 방이 30초 쉬지 않게)
      if (code === 'EMOTE_TOO_FREQUENT') return opts.onError(t('openSea.emoteTooFrequent'));
      stompErrors += 1;
      if (stompErrors >= STOMP_ERROR_LIMIT && !suspended && !closed) {
        // 무한 거절 루프를 끊되 영구히 멈추지는 않는다 — 30초 → 60초 → 120초(상한) 뒤 다시 붙는다
        suspended = true;
        void client.deactivate();
        const delay =
          SEA_RECONNECT_BACKOFF_MS[Math.min(backoffStep, SEA_RECONNECT_BACKOFF_MS.length - 1)];
        backoffStep += 1;
        retryTimer = setTimeout(resume, delay);
        if (!limitNotified) {
          limitNotified = true;
          const text = friendlyRealtimeErrorMessage(code || '실시간 연결이 거절됐어요.');
          if (text) opts.onError(text);
        }
      }
    },
  });
  const timer = setInterval(() => {
    if (!client.connected) return;
    if (roomId) send('/app/sea/sync');
    else enter();
  }, SEA_SYNC_MS);
  client.activate();
  return {
    sendEmote: (type) => {
      if (closed || !roomId || !EMOTE_TYPES.has(type) || now() - lastEmote < EMOTE_TRY_MS)
        return false;
      if (!send(`/app/sea/rooms/${roomId}/emotes`, { type })) return false;
      lastEmote = now();
      return true;
    },
    reconnect: resume,
    close: () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      clearInterval(timer);
      send('/app/sea/leave');
      void client.deactivate();
    },
  };
}
