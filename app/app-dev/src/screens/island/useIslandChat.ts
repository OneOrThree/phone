/**
 * 우리 섬 채팅방 훅 — 우체통에서 꺼낸 섬 단체 채팅(GROMO-2499). UI 는 이 파일 밖이다.
 *
 * - 첫 목록부터 GET /islands/{id}/messages 로 읽는다. 우체통 묶음(/screens/mailbox)은 부르지 않는다 —
 *   채팅은 우체통이 없는 섬에서도 열리는데, 묶음은 편지 시설 검사에 걸린다.
 * - `active` 인 동안만 읽는다: 켜지는 순간·앱 전면 복귀에 바로, 그 뒤 10초마다. 꺼지거나 백그라운드면
 *   멈추고 읽은 글은 남긴다 — 다시 켜면 마지막 조회 지점부터 이어 읽는다.
 * - `islandId`·세션 세대가 바뀌면 옛 글을 지우고 처음부터 읽는다. 모든 비동기 적용 지점은
 *   mounted+epoch+세대 fence 를 다시 본다 — 섬·계정이 바뀐 뒤 도착한 늦은 응답은 버린다.
 * - 보내기는 {clientMessageId} 가 서버 멱등키다 — 같은 본문의 재시도는 같은 키로 보내 서버가 원본을
 *   재생한다(중복 글 없음). 성공 응답의 메시지만 목록 끝에 붙인다(로컬 합성 금지).
 * - 권한 상실(401/403)이면 글을 지우고 자동 재요청을 멈춘다. 다시 시도(retry)만 다시 읽는다.
 * - 차단한 사람의 글은 보이지 않는다. 서버는 채팅 글을 거르지 않으므로 화면에서만 거르고, 차단 목록을
 *   아직 못 읽었으면 글 전체를 숨긴다(fail-closed).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, CLIENT_STALE_SESSION, uuid } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';
import { listIslandMessages, sendIslandMessage, type MailboxMessage } from '@/services/api/letters';
import { CLIENT_INACTIVE, CLIENT_WRITE_IN_PROGRESS } from '@/screens/interiors/useBoardNotices';
import { useBlockedUsers } from '@/services/blockedUsers';

/** 채팅 최신 이력 갱신 주기. */
export const ISLAND_CHAT_REFRESH_MS = 10_000;

export type IslandChatState = {
  /** 오래된 것부터(서버 순서 그대로). */
  messages: MailboxMessage[];
  /** 더 오래된 글을 읽을 커서. null 이면 끝이다. */
  messagesCursor: string | null;
  /** 첫 목록을 아직 받지 못했다. */
  loading: boolean;
  loadingMore: boolean;
  /** 마지막 조회 실패(첫 목록 포함). 다음 조회가 성공하면 지운다. */
  error: ApiError | null;
};

const EMPTY: IslandChatState = {
  messages: [],
  messagesCursor: null,
  loading: true,
  loadingMore: false,
  error: null,
};

/** 읽기 경로의 권한 상실은 캐시 삭제다 — 권한 없는 글을 화면에 남기지 않는다. */
const authLost = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

/** 쓰기 의도 슬롯 — key 는 본문이 같을 때만 유지된다. */
type IntentSlot = { key: string; payload: string; flight: Promise<MailboxMessage> | null };

export function useIslandChat({ islandId, active }: { islandId: string | null; active: boolean }) {
  const enabled = active && !!islandId;
  // 채팅은 다른 사람의 글을 그리므로 TTL cache만 믿지 않고 켜질 때마다 차단 목록을 재검증한다.
  const blockedUsers = useBlockedUsers(enabled, enabled);
  const blockedIds = blockedUsers.ids;
  const retryBlockedUsers = blockedUsers.retry;
  const generation = sessionGeneration();
  const [state, setState] = useState<IslandChatState>(EMPTY);
  const stateRef = useRef(state);
  const set = useCallback((patch: Partial<IslandChatState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);
  const mounted = useRef(false);
  const epoch = useRef(0);
  // 발송 응답이 아니라 마지막 이력 조회의 끝이다. 내 새 글을 기준으로 잡으면
  // 그 사이 도착한 상대 글을 페이지 경계에서 놓칠 수 있다.
  const latestReadMessageId = useRef<string | null>(null);
  const intents = useRef(new Map<string, IntentSlot>());
  // 다시 시도 — 값이 바뀌면 갱신 effect 를 새로 열어 바로 읽는다(권한 상실로 멈춘 갱신도 다시 연다).
  const [retryKey, setRetryKey] = useState(0);
  const alive = useCallback(
    (e: number, requestGeneration: number) =>
      mounted.current && e === epoch.current && requestGeneration === sessionGeneration(),
    [],
  );
  const stale = () =>
    new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);

  // 선언 순서가 곧 실행 순서다 — 범위 초기화·갱신 effect 보다 먼저 mounted 를 세운다.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 섬·계정이 바뀌면 옛 글과 이어 읽기 지점을 버린다.
  useEffect(() => {
    epoch.current += 1;
    latestReadMessageId.current = null;
    intents.current.clear();
    set(EMPTY);
  }, [islandId, generation, set]);

  // 켜져 있는 동안 최신 이력을 읽는다. 입력창·이전 이력은 건드리지 않는다.
  useEffect(() => {
    if (!enabled || !islandId || blockedUsers.status !== 'ready') return;
    const e = epoch.current;
    const requestGeneration = sessionGeneration();
    let disposed = false;
    let foreground = AppState.currentState == null || AppState.currentState === 'active';
    let visibilityEpoch = 0;
    let inFlight = false;
    let denied = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = (visibility: number) =>
      !disposed && foreground && visibility === visibilityEpoch && alive(e, requestGeneration);
    const schedule = () => {
      if (!disposed && foreground && !denied)
        timer = setTimeout(() => {
          void refresh();
        }, ISLAND_CHAT_REFRESH_MS);
    };
    const refresh = async () => {
      if (disposed || !foreground || inFlight || denied) return;
      inFlight = true;
      const visibility = visibilityEpoch;
      const anchor = latestReadMessageId.current;
      try {
        let page = await listIslandMessages(islandId);
        if (!current(visibility)) return;
        const first = page;
        const incoming = [...page.items];
        const cursors = new Set<string>();
        // 최신 한 페이지를 넘는 새 글도 마지막 조회 지점까지 읽어 빠짐없이 이어 붙인다.
        while (
          anchor &&
          !page.items.some((message) => message.id === anchor) &&
          page.nextCursor !== null
        ) {
          const cursor = page.nextCursor;
          if (cursors.has(cursor))
            throw new ApiError('INVALID_CURSOR', '새 글을 이어서 불러오지 못했어요.', 0);
          cursors.add(cursor);
          page = await listIslandMessages(islandId, cursor);
          if (!current(visibility)) return;
          incoming.push(...page.items);
        }
        const merged = new Map(stateRef.current.messages.map((message) => [message.id, message]));
        for (const message of incoming) merged.set(message.id, message);
        latestReadMessageId.current = first.items.at(-1)?.id ?? anchor;
        set({
          messages: [...merged.values()].sort(
            (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
          ),
          // 기존 과거 페이지 커서는 그대로 둔다. 빈 이력에서 처음 읽은 경우만 초기화한다.
          ...(anchor === null ? { messagesCursor: first.nextCursor } : {}),
          loading: false,
          error: null,
        });
      } catch (error) {
        if (!current(visibility)) return;
        denied = authLost(error);
        set({
          ...(denied ? { messages: [], messagesCursor: null } : {}),
          loading: false,
          error: error as ApiError,
        });
        if (denied) latestReadMessageId.current = null;
      } finally {
        inFlight = false;
        if (!disposed && foreground && !denied) {
          // 백그라운드에서 시작한 응답은 버리고 복귀 직후 새 요청으로 대체한다.
          if (visibility !== visibilityEpoch) void refresh();
          else schedule();
        }
      }
    };
    const subscription = AppState.addEventListener('change', (next) => {
      const nextForeground = next === 'active';
      if (nextForeground === foreground) return;
      foreground = nextForeground;
      visibilityEpoch += 1;
      clearTimeout(timer);
      if (foreground) void refresh();
    });
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [enabled, islandId, generation, blockedUsers.status, retryKey, alive, set]);

  const loadMoreMessages = useCallback(async () => {
    const { messagesCursor, loadingMore, loading } = stateRef.current;
    if (
      !mounted.current ||
      !enabled ||
      !islandId ||
      messagesCursor === null ||
      loadingMore ||
      loading
    )
      return;
    const e = epoch.current;
    const requestGeneration = sessionGeneration();
    set({ loadingMore: true });
    try {
      const page = await listIslandMessages(islandId, messagesCursor);
      if (!alive(e, requestGeneration)) return;
      // 다음 묶음은 더 오래된 글이다 — 앞에 붙이고 id 중복을 막는다.
      const seen = new Set(stateRef.current.messages.map((m) => m.id));
      set({
        messages: [...page.items.filter((m) => !seen.has(m.id)), ...stateRef.current.messages],
        messagesCursor: page.nextCursor,
        loadingMore: false,
      });
    } catch (error) {
      if (!alive(e, requestGeneration)) return;
      if (authLost(error)) set({ messages: [], messagesCursor: null, loadingMore: false });
      else set({ loadingMore: false });
    }
  }, [alive, enabled, islandId, set]);

  /**
   * 글 보내기 — clientMessageId 가 서버 멱등키다. 같은 본문의 재시도(응답 유실·네트워크 실패)는
   * 같은 키로 보내 서버가 원본을 재생한다. 성공하면 서버가 돌려준 글을 목록 끝에 붙인다.
   */
  const sendMessage = useCallback(
    async (text: string): Promise<MailboxMessage> => {
      if (!mounted.current || !enabled || !islandId)
        throw new ApiError(CLIENT_INACTIVE, '지금은 글을 남길 수 없어요.', 0);
      const e = epoch.current;
      const requestGeneration = sessionGeneration();
      const slotId = `message:${islandId}`;
      const prev = intents.current.get(slotId);
      if (prev?.flight) {
        if (prev.payload === text) return prev.flight;
        throw new ApiError(CLIENT_WRITE_IN_PROGRESS, '이전 글을 보내는 중이에요.', 0);
      }
      const slot: IntentSlot =
        prev && prev.payload === text ? prev : { key: uuid(), payload: text, flight: null };
      const flight = (async () => {
        const message = await sendIslandMessage(islandId, { clientMessageId: slot.key, text });
        if (!alive(e, requestGeneration)) throw stale();
        const dup = stateRef.current.messages.some(
          (m) => m.id === message.id || m.clientMessageId === message.clientMessageId,
        );
        if (!dup) set({ messages: [...stateRef.current.messages, message] });
        if (intents.current.get(slotId) === slot) intents.current.delete(slotId);
        return message;
      })();
      slot.flight = flight;
      intents.current.set(slotId, slot);
      // 실패하면 키는 남긴다 — 같은 본문의 재시도가 같은 clientMessageId 로 간다.
      flight.catch(() => {
        if (intents.current.get(slotId) === slot) slot.flight = null;
      });
      return flight;
    },
    [alive, enabled, islandId, set],
  );

  const retry = useCallback(async () => {
    if (blockedUsers.status === 'error') await retryBlockedUsers();
    setRetryKey((key) => key + 1);
  }, [blockedUsers.status, retryBlockedUsers]);

  const visible = useMemo(() => {
    if (blockedUsers.status !== 'ready') {
      const blockedListError =
        blockedUsers.status === 'error'
          ? blockedUsers.error instanceof ApiError
            ? blockedUsers.error
            : new ApiError('BLOCKED_USERS_UNAVAILABLE', '차단 목록을 불러오지 못했어요.', 0)
          : null;
      return {
        ...state,
        messages: [],
        // 차단 목록 조회가 실패하면 로딩을 끝내 오류·재시도를 노출한다 — 이력 effect 는 ready 가 아니면
        // 돌지 않아 state.loading 이 초기 true 로 남으므로, 여기서는 차단 목록 조회 상태만 본다.
        loading: blockedUsers.status === 'loading',
        error: blockedListError ?? state.error,
      };
    }
    return { ...state, messages: state.messages.filter((m) => !blockedIds.has(m.userId)) };
  }, [blockedIds, blockedUsers.error, blockedUsers.status, state]);

  return {
    ...visible,
    myId: getSession()?.userId ?? null,
    retry,
    loadMoreMessages,
    sendMessage,
  };
}

export type IslandChat = ReturnType<typeof useIslandChat>;
