/**
 * 우체통 화면 훅 — GET /screens/mailbox 한 묶음 + /letters 읽기·발송·닫기를 연다 (GROMO-2016).
 * 섬 단체 채팅은 우체통 밖으로 꺼내 useIslandChat 이 맡는다(GROMO-2499). UI 는 이 파일 밖이다.
 *
 * - `active=false` 이면 API 를 하나도 부르지 않는다(목업 시안·방문객의 요청 0 보장).
 *   읽기 액션은 조용히 무시하고, 쓰기 액션은 CLIENT_INACTIVE 로 던진다.
 * - `scopeKey`(섬·화면 범위)나 세션 세대가 바뀌면 옛 데이터를 지우고 처음부터 다시 읽는다.
 *   모든 비동기 적용 지점은 mounted+epoch+세대 fence 를 다시 본다 — 언마운트·범위
 *   교체·계정 전환 뒤 도착한 늦은 응답은 버린다.
 *
 * 읽기와 닫기는 다르다:
 * - openLetter 는 GET /letters/{id} — 서버가 readAt 을 찍지만 편지는 남는다.
 * - close 는 DELETE /letters/{id} — 서버가 양쪽 목록에서 지운다. 성공(또는 이미
 *   닫힌 404) 뒤에만 받은·보낸 목록을 재조회하고, 재조회가 실패하면 닫기도 실패로
 *   던진다 — 재시도는 404 로 수렴해 다시 성공한다(응답 유실 뒤 같은 의도 재시도 안전).
 *
 * 발송(POST /letters)은 서버에 멱등 키 계약이 없다 — 응답 유실 뒤 재시도는 중복
 * 편지를 만들 수 있어 자동 재시도하지 않고 진행 중 탭만 막는다. 201 이 오면 발송
 * 자체는 확정이다 — 목록 재조회는 최선 노력으로 붙이되 그 실패를 발송 실패로
 * 뒤집지 않는다(실패로 보이면 사용자가 재시도해 중복이 생긴다).
 *
 * 섬 시스템 편지(강퇴·가입 승인, GROMO-2275)는 GET /letters?kind=system 으로 따로 읽어
 * `systemLetters` 에 둔다 — 친구 편지·안 읽음 수·페이지 커서와 섞지 않는다. 조회는 최선
 * 노력이라 기다리지 않는다: 묶음·받은/보낸 목록을 먼저 적용하고 시스템 편지는 뒤따라
 * 같은 세션·세대(epoch/generation) 검증을 거쳐 반영하므로, 느리거나 실패해도 친구 우체통·
 * 닫기·발송을 막지 않는다(재조회 실패는 이전 값 유지). 닫기가 확정된 시스템 편지는 재조회
 * 결과와 무관하게 바로 뺀다. kind 를 모르는 옛 서버가 친구함을 돌려줘도 시스템 편지(kind 가
 * 있거나 발신자가 없는 항목, isSystemLetter)만 받는다.
 *
 * 권한 상실(401/403)이 읽기 경로에서 오면 화면 캐시(편지·친구·상세)를 지운다 —
 * 권한을 잃은 뒤 캐시된 편지가 다시 보이면 안 된다. 상세의 403/404 는 그 편지의
 * 목록 항목도 함께 지운다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, CLIENT_STALE_SESSION } from '@/services/api/client';
import { getSession, sessionGeneration } from '@/services/api/session';
import { captureProductEvent } from '@/services/posthog';
import {
  closeLetter as delLetter,
  getLetter,
  getMailboxScreen,
  isSystemLetter,
  isSystemLetterView,
  listLetters,
  listSystemLetters,
  sendLetter as postLetter,
  type LetterItem,
  type LetterView,
  type MailboxFriend,
} from '@/services/api/letters';
import { CLIENT_INACTIVE, CLIENT_WRITE_IN_PROGRESS } from './useBoardNotices';
import { isUserBlocked, useBlockedUsers } from '@/services/blockedUsers';

export type MailboxState = {
  islandId: string | null;
  islandName: string | null;
  memberCount: number;
  /** 세션의 내 userId. */
  myId: string | null;
  /** 받은 편지 최신순. */
  letters: LetterItem[];
  lettersCursor: string | null;
  /** 섬 시스템 편지(발신자 없음) 최신순 — 첫 20통만, 안 읽음 수에 넣지 않는다. */
  systemLetters: LetterItem[];
  /** 보낸 편지 — 닫기·발송 뒤 양쪽 정본 재조회로만 채운다. */
  sent: LetterItem[];
  sentCursor: string | null;
  friends: MailboxFriend[];
  loading: boolean;
  loadingMoreLetters: boolean;
  error: ApiError | null;
  detail: LetterView | null;
  detailLoading: boolean;
  detailError: ApiError | null;
  sending: boolean;
  closing: boolean;
};

const EMPTY: MailboxState = {
  islandId: null,
  islandName: null,
  memberCount: 0,
  myId: null,
  letters: [],
  lettersCursor: null,
  systemLetters: [],
  sent: [],
  sentCursor: null,
  friends: [],
  loading: false,
  loadingMoreLetters: false,
  error: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  sending: false,
  closing: false,
};

/** 읽기 경로의 권한 상실은 캐시 삭제다 — 권한 없는 데이터를 화면에 남기지 않는다. */
const authLost = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);

/** 시스템 편지 최선 노력 조회 — 실패(또는 모양 불일치)는 null, 시스템 편지가 아닌 항목(옛 서버의 친구 항목)은 버린다. */
const fetchSystemLetters = async (): Promise<LetterItem[] | null> => {
  try {
    return (await listSystemLetters()).content.filter(isSystemLetter);
  } catch {
    return null;
  }
};

export function useMailbox({ active, scopeKey }: { active: boolean; scopeKey: string }) {
  // 우체통은 편지 원문을 그리므로 TTL cache만 믿지 않고 진입마다 재검증한다.
  const blockedUsers = useBlockedUsers(active, active);
  const blockedIds = blockedUsers.ids;
  const retryBlockedUsers = blockedUsers.retry;
  const generation = sessionGeneration();
  const previousBlockedIds = useRef<{
    generation: number;
    ids: ReadonlySet<string> | null;
  }>({ generation, ids: null });
  const suppressNextBlockedRefresh = useRef(false);
  const [state, setState] = useState<MailboxState>(EMPTY);
  const stateRef = useRef(state);
  const set = useCallback((patch: Partial<MailboxState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const mounted = useRef(false);
  const epoch = useRef(0);
  // 상세 경합 fence — 마지막으로 연 편지만 detail 로 적용된다.
  const openSeq = useRef(0);
  const requestedDetailId = useRef<string | null>(null);
  // 캐시된 섬 데이터가 어느 epoch·세대에서 왔는지 — 계정/범위 교체 직후 옛 islandId 를
  // 새 계정 토큰으로 보내는 것을 막는다.
  const proven = useRef({ epoch: -1, generation: -1 });
  const cached = useCallback(
    () =>
      proven.current.epoch === epoch.current && proven.current.generation === sessionGeneration(),
    [],
  );
  const stale = () =>
    new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요. 다시 시도해 주세요.', 0);
  const alive = useCallback(
    (e: number, generation: number) =>
      mounted.current && e === epoch.current && generation === sessionGeneration(),
    [],
  );

  // 시스템 편지 조회 순번 — 가장 최근에 시작한 조회의 응답만 반영한다(옛 응답이 닫은 편지를 되살리지 않게).
  const systemSeq = useRef(0);
  /** 시스템 편지를 최선 노력으로 읽어 뒤에 반영한다 — 기다리지 않고, 실패하면 이전 값을 둔다. */
  const loadSystemLetters = useCallback(
    (e: number, generation: number) => {
      const seq = ++systemSeq.current;
      void fetchSystemLetters().then((system) => {
        if (system && alive(e, generation) && seq === systemSeq.current)
          set({ systemLetters: system });
      });
    },
    [alive, set],
  );

  const load = useCallback(async () => {
    if (!mounted.current || !active) return;
    const e = ++epoch.current;
    const generation = sessionGeneration();
    set({ ...EMPTY, loading: true });
    // 묶음과 나란히 시작하되 기다리지 않는다 — 느린 시스템 조회가 친구 우체통 로딩을 묶지 않는다.
    loadSystemLetters(e, generation);
    try {
      const screen = await getMailboxScreen();
      if (!alive(e, generation)) return;
      proven.current = { epoch: e, generation };
      set({
        islandId: screen.island.id,
        islandName: screen.island.name,
        memberCount: screen.island.memberCount,
        myId: getSession()?.userId ?? null,
        letters: screen.letters.content,
        lettersCursor: screen.letters.nextCursor,
        friends: screen.friends,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (!alive(e, generation)) throw error;
      // 권한 상실이면 캐시를 비운 채 오류만 남긴다 — EMPTY patch 가 데이터를 지운다.
      if (authLost(error)) {
        systemSeq.current += 1; // 뒤늦게 온 시스템 편지가 비운 캐시를 다시 채우지 못하게 한다.
        set({ ...EMPTY, loading: false, error: error as ApiError });
      } else set({ loading: false, error: error as ApiError });
      throw error;
    }
  }, [active, alive, loadSystemLetters, set]);

  const loadMoreLetters = useCallback(async () => {
    const { lettersCursor, loading, loadingMoreLetters } = stateRef.current;
    if (
      !mounted.current ||
      !active ||
      lettersCursor === null ||
      loading ||
      loadingMoreLetters ||
      !cached()
    )
      return;
    const e = epoch.current;
    const generation = sessionGeneration();
    set({ loadingMoreLetters: true });
    try {
      const page = await listLetters('received', lettersCursor);
      if (!alive(e, generation)) return;
      const seen = new Set(stateRef.current.letters.map((l) => l.id));
      set({
        letters: [...stateRef.current.letters, ...page.content.filter((l) => !seen.has(l.id))],
        lettersCursor: page.nextCursor,
        loadingMoreLetters: false,
      });
    } catch (error) {
      if (!alive(e, generation)) return;
      if (authLost(error)) {
        systemSeq.current += 1;
        set({
          letters: [],
          lettersCursor: null,
          systemLetters: [],
          sent: [],
          sentCursor: null,
          detail: null,
          loadingMoreLetters: false,
          error: error as ApiError,
        });
      } else set({ loadingMoreLetters: false, error: error as ApiError });
    }
  }, [active, alive, cached, set]);

  /** 받은·보낸 목록을 서버 정본으로 다시 읽는다 — 닫기의 양쪽 제거는 서버 몫이다. */
  const refreshLetters = useCallback(
    async (e: number, generation: number) => {
      if (!alive(e, generation)) throw stale();
      // 시스템 편지는 기다리지 않는다 — 닫기·발송의 성공 판정은 친구 목록 재조회만 본다.
      loadSystemLetters(e, generation);
      const [received, sent] = await Promise.all([listLetters('received'), listLetters('sent')]);
      if (!alive(e, generation)) throw stale();
      proven.current = { epoch: e, generation };
      set({
        letters: received.content,
        lettersCursor: received.nextCursor,
        sent: sent.content,
        sentCursor: sent.nextCursor,
      });
    },
    [alive, loadSystemLetters, set],
  );

  /**
   * 편지 열기 — GET 상세다. 서버가 수신자의 readAt 을 찍으니 목록 항목의 isRead 도
   * 응답 값으로 맞춘다(로컬 추측이 아니라 서버 확인값).
   */
  const openLetter = useCallback(
    async (letterId: string) => {
      const seq = ++openSeq.current;
      if (!mounted.current || !active || !cached()) return;
      requestedDetailId.current = letterId;
      const e = epoch.current;
      const generation = sessionGeneration();
      set({ detail: null, detailLoading: true, detailError: null });
      try {
        const detail = await getLetter(letterId);
        if (!alive(e, generation) || seq !== openSeq.current) return;
        const markRead = (list: LetterItem[]) =>
          list.map((l) =>
            l.id === letterId && detail.readAt !== null ? { ...l, isRead: true } : l,
          );
        set({
          detail,
          detailLoading: false,
          letters: markRead(stateRef.current.letters),
          systemLetters: markRead(stateRef.current.systemLetters),
        });
      } catch (error) {
        if (!alive(e, generation) || seq !== openSeq.current) return;
        // 권한 상실·이미 지워진 편지는 목록 캐시에서도 지운다 — 캐시로 재진입 금지.
        const gone = error instanceof ApiError && (error.status === 403 || error.status === 404);
        if (gone && requestedDetailId.current === letterId) requestedDetailId.current = null;
        set({
          detail: null,
          detailLoading: false,
          detailError: error as ApiError,
          letters: gone
            ? stateRef.current.letters.filter((l) => l.id !== letterId)
            : stateRef.current.letters,
          systemLetters: gone
            ? stateRef.current.systemLetters.filter((l) => l.id !== letterId)
            : stateRef.current.systemLetters,
        });
      }
    },
    [active, alive, cached, set],
  );

  const clearDetail = useCallback(() => {
    openSeq.current += 1;
    requestedDetailId.current = null;
    set({ detail: null, detailLoading: false, detailError: null });
  }, [set]);

  /**
   * 편지 닫기 — DELETE /letters/{id}. 성공 또는 이미 닫힌 404(응답 유실 재시도의
   * 도착점)만 성공으로 접고, 그 뒤 받은·보낸 목록을 재조회한다. 재조회 실패는
   * 닫기 실패로 던진다 — 재시도가 404 로 수렴해 다시 성공한다.
   */
  const close = useCallback(
    async (letterId: string): Promise<void> => {
      if (!mounted.current || !active)
        throw new ApiError(CLIENT_INACTIVE, '지금은 편지를 닫을 수 없어요.', 0);
      if (!cached()) throw stale();
      const e = epoch.current;
      const generation = sessionGeneration();
      set({ closing: true });
      try {
        try {
          await delLetter(letterId);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
          // 404 — 첫 응답이 유실된 재시도거나 다른 곳에서 이미 닫았다. 서버 정본은
          // 「없음」이니 목록 재조회로 같은 상태에 수렴한다.
        }
        // 닫기가 확정된 시스템 편지는 재조회 결과(실패 포함)와 무관하게 바로 뺀다 — 재조회가
        // 실패해도 닫은 편지가 되살아나 눌렀다가 404 가 나지 않게.
        if (alive(e, generation)) {
          systemSeq.current += 1; // 이미 떠 있는 옛 조회 응답이 방금 뺀 편지를 되살리지 못하게 이 줄이 직접 올린다.
          set({ systemLetters: stateRef.current.systemLetters.filter((l) => l.id !== letterId) });
        }
        await refreshLetters(e, generation);
        if (stateRef.current.detail?.id === letterId) set({ detail: null });
      } finally {
        if (alive(e, generation)) set({ closing: false });
      }
    },
    [active, alive, cached, refreshLetters, set],
  );

  /**
   * 편지 발송 — POST /letters. 멱등 키 계약이 없으므로 진행 중 중복 탭만 막는다.
   * 201 이 오면 발송은 확정 — 목록 재조회 실패를 발송 실패로 뒤집지 않는다.
   */
  const send = useCallback(
    async (receiverId: string, content: string): Promise<LetterView> => {
      if (!mounted.current || !active)
        throw new ApiError(CLIENT_INACTIVE, '지금은 편지를 보낼 수 없어요.', 0);
      if (!cached()) throw stale();
      if (isUserBlocked(receiverId)) {
        throw new ApiError('CLIENT_BLOCKED_USER', '차단한 사용자에게는 편지를 보낼 수 없어요.', 0);
      }
      if (stateRef.current.sending)
        throw new ApiError(CLIENT_WRITE_IN_PROGRESS, '편지를 보내는 중이에요.', 0);
      const e = epoch.current;
      const generation = sessionGeneration();
      set({ sending: true });
      try {
        const created = await postLetter({ receiverId, content });
        // POST 201 = 발송 확정 1회(sending 플래그로 중복 탭 차단) — 우체통 핵심 행동
        captureProductEvent('feature_used', { building: 'mail', action: 'send' });
        await refreshLetters(e, generation).catch(() => {});
        return created;
      } finally {
        if (alive(e, generation)) set({ sending: false });
      }
    },
    [active, alive, cached, refreshLetters, set],
  );

  // 선언 순서가 곧 실행 순서다 — load effect 보다 먼저 mounted 를 세운다.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (previousBlockedIds.current.generation !== generation) {
      previousBlockedIds.current = { generation, ids: null };
    }
    if (!active || blockedUsers.status !== 'ready') return;
    const previous = previousBlockedIds.current.ids;
    previousBlockedIds.current.ids = blockedIds;
    // 사용자가 누른 retry가 바로 아래에서 우체통을 직접 적재하므로, 그 retry가 만든
    // 차단 snapshot 변경을 effect에서도 한 번 더 적재하지 않는다.
    if (suppressNextBlockedRefresh.current) {
      suppressNextBlockedRefresh.current = false;
      return;
    }
    // 차단 중 서버 응답에는 상대의 편지·친구가 빠져 있으므로 해제가 확인되면
    // 로컬 필터만 풀지 말고 우체통 묶음 자체를 다시 읽어 복원한다.
    if (previous?.size && [...previous].some((id) => !blockedIds.has(id))) {
      const openDetailId =
        stateRef.current.detail?.id ??
        (stateRef.current.detailLoading ? requestedDetailId.current : null);
      load()
        .then(() => (openDetailId ? openLetter(openDetailId) : undefined))
        .catch((error) => {
          if (!mounted.current || generation !== sessionGeneration()) return;
          // 상세 route를 유지한 채 묶음 재적재가 실패하면 무한 로딩 대신 재시도를 노출한다.
          set({ detailLoading: false, detailError: error as ApiError });
        });
    }
  }, [active, blockedIds, blockedUsers.status, generation, load, openLetter, set]);

  useEffect(() => {
    epoch.current += 1;
    if (!active) set(EMPTY);
    else load().catch(() => {});
    return () => {
      epoch.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeKey·generation 은 재시작 신호다.
  }, [active, scopeKey, generation, load]);

  const visibleState = useMemo(() => {
    // 시스템 편지는 목록처럼 차단 판정 밖이다(발신자 id 가 채워져 와도 사람의 편지가 아니다).
    const counterpart = (detail: LetterView) =>
      isSystemLetterView(detail)
        ? ''
        : ((detail.senderId === state.myId ? detail.receiverId : detail.senderId) ?? '');
    if (active && blockedUsers.status !== 'ready') {
      const blockedListError =
        blockedUsers.status === 'error'
          ? blockedUsers.error instanceof ApiError
            ? blockedUsers.error
            : new ApiError('BLOCKED_USERS_UNAVAILABLE', '차단 목록을 불러오지 못했어요.', 0)
          : null;
      return {
        ...state,
        letters: [],
        systemLetters: [],
        sent: [],
        friends: [],
        detail: null,
        detailBlocked: false,
        detailError: blockedListError ?? state.detailError,
        loading: blockedUsers.status === 'loading' || state.loading,
        error: blockedListError ?? state.error,
      };
    }
    return {
      ...state,
      letters: state.letters.filter((letter) => !blockedIds.has(letter.counterpartUserId ?? '')),
      sent: state.sent.filter((letter) => !blockedIds.has(letter.counterpartUserId ?? '')),
      friends: state.friends.filter((friend) => !blockedIds.has(friend.userId)),
      detailBlocked: !!state.detail && blockedIds.has(counterpart(state.detail)),
      detail: state.detail && !blockedIds.has(counterpart(state.detail)) ? state.detail : null,
    };
  }, [active, blockedIds, blockedUsers.error, blockedUsers.status, state]);

  const retry = useCallback(async () => {
    const retryingDetail =
      stateRef.current.detail !== null ||
      stateRef.current.detailError !== null ||
      stateRef.current.detailLoading;
    try {
      if (blockedUsers.status === 'error') {
        suppressNextBlockedRefresh.current = true;
        try {
          await retryBlockedUsers();
        } catch (error) {
          suppressNextBlockedRefresh.current = false;
          throw error;
        }
      }
      await load();
    } catch (error) {
      if (retryingDetail && mounted.current) {
        set({ detailLoading: false, detailError: error as ApiError });
      }
      throw error;
    }
  }, [blockedUsers.status, load, retryBlockedUsers, set]);

  return {
    ...visibleState,
    blockedUsersStatus: blockedUsers.status,
    retry,
    loadMoreLetters,
    openLetter,
    clearDetail,
    close,
    send,
  };
}
