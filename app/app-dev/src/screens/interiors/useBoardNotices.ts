/**
 * 섬 게시판 화면 훅 — 공지(GROMO-2013)와 일일 퀘스트(GROMO-2014)를 함께 싣는다.
 * UI 는 이 파일 밖이다.
 *
 * - `active=false` 이면 API 를 하나도 부르지 않는다(비활성 화면·방문객의 요청 0 보장).
 *   읽기 액션은 조용히 무시하고, 쓰기 액션은 CLIENT_INACTIVE 로 던져 호출부 초안을 보존한다.
 * - `scopeKey`(섬·화면 범위)나 세션 세대가 바뀌면 옛 데이터를 지우고 첫 페이지부터 다시 읽는다.
 * - 모든 비동기 적용 지점은 「요청 시작 시점의 mounted+epoch+세대」를 다시 본다 — 언마운트·
 *   범위 교체·계정 전환 뒤 도착한 늦은 응답은 버린다(client 의 CLIENT_STALE_SESSION 과 같은 fence).
 *
 * 쓰기 네 종은 의도(intent)마다 하나의 `Idempotency-Key` 를 쓴다. 같은 페이로드의 재시도
 * (응답 유실·retryable 실패)는 **같은 key** 로 다시 보내고, 쓰기 성공 + GET 새로고침이 끝나야
 * key 를 놓는다 — 다음 의도는 새 key 다(notices.ts 의 계약). 진행 중인 같은 슬롯 호출은
 * 새 요청을 내지 않고 진행 중인 promise 를 돌려준다(중복 탭).
 *
 * 퀘스트는 getBoard 가 싣는 `quests.items`(현재 회차 헤더·내 진행률·수령 상태·지갑)를 목록으로
 * 쓰고, 주민별 진행은 `selectQuest` 의 progress GET 이 가져온다. 수령·생성·수정 성공 뒤에는
 * refreshList 가 목록과 지갑을 함께 다시 읽는다 — 앱이 보상량을 로컬 지갑에 더하지 않는다.
 * claim 의 버전은 목록 항목의 `version` 이고, 403/409 실패 뒤엔 목록을 다시 읽어 새 버전·
 * 권한을 받아 온다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, CLIENT_STALE_SESSION, uuid } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import {
  createNotice as postNotice,
  createNoticeComment as postComment,
  deleteNotice as delNotice,
  getBoard,
  getNotice,
  listNotices,
  updateNotice as patchNotice,
  type CommentCreated,
  type NoticeDeleted,
  type NoticeDetail,
  type NoticePage,
  type NoticeWriteResult,
} from '@/services/api/notices';
import {
  claimQuest as postClaim,
  createQuest as postQuest,
  getQuestProgress,
  updateQuest as patchQuest,
  type QuestClaimed,
  type QuestCreateBody,
  type QuestCreated,
  type QuestItem,
  type QuestProgress,
  type QuestUpdateBody,
  type QuestUpdated,
} from '@/services/api/quests';

export type NoticeItem = NoticePage['items'][number];

/** 실제로 불러온 공지만 확인한다. nextCursor가 null일 때만 전체 목록이다. */
export type BoardLoadedSnapshot = {
  islandId: string;
  items: NoticeItem[];
  nextCursor: string | null;
};

/** 화면이 비활성·섬 미확정이라 쓰기를 시작할 수 없다 — 호출부 분기용 클라이언트 코드. */
export const CLIENT_INACTIVE = 'CLIENT_INACTIVE';
/** 같은 슬롯의 쓰기가 아직 진행 중인데 다른 본문이 들어왔다 — 이전 결과를 새 초안에 입히지 않는다. */
export const CLIENT_WRITE_IN_PROGRESS = 'CLIENT_WRITE_IN_PROGRESS';

export type BoardNoticesState = {
  islandId: string | null;
  /** getBoard 의 island.role — 쓰기 버튼 노출은 이 값이 'host' 일 때만(로딩·실패는 추측하지 않는다). */
  islandRole: 'host' | 'member' | null;
  items: NoticeItem[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: ApiError | null;
  detail: NoticeDetail | null;
  detailLoading: boolean;
  detailError: ApiError | null;
  loadingMoreComments: boolean;
  /** 현재 회차 헤더 — getBoard 의 quests.items 가 정본이다. */
  quests: QuestItem[];
  /** 열린 퀘스트의 회차 진행(주민별 rate·achieved·claimed) — progress GET 의 응답 그대로다. */
  questDetail: QuestProgress | null;
  questDetailLoading: boolean;
  questDetailError: ApiError | null;
  /** getBoard가 내려준 서버 정본 지갑. 수령 후 refreshList에서 같이 갱신한다. */
  wallets: {
    fish: number;
    villagePoints: number;
    fishVersion: number | null;
    villagePointsVersion: number;
  } | null;
};

const EMPTY: BoardNoticesState = {
  islandId: null,
  islandRole: null,
  items: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
  detail: null,
  detailLoading: false,
  detailError: null,
  loadingMoreComments: false,
  quests: [],
  questDetail: null,
  questDetailLoading: false,
  questDetailError: null,
  wallets: null,
};

/**
 * progress 응답의 주민은 회차 스냅숏 커서로 페이징된다. 상세 화면은 전체 대상을
 * 그리므로 서버가 발급한 nextCursor를 끝까지 따라가고 userId로 경계 중복을 막는다.
 */
async function getAllQuestProgress(
  islandId: string,
  questId: string,
  occurrenceId: string,
): Promise<QuestProgress> {
  let page = await getQuestProgress(islandId, questId, occurrenceId);
  const first = page;
  const members = [...page.members];
  const seenMembers = new Set(members.map((member) => member.userId));
  const seenCursors = new Set<string>();
  while (page.nextCursor !== null) {
    const cursor = page.nextCursor;
    if (seenCursors.has(cursor))
      throw new ApiError('INVALID_CURSOR', '퀘스트 주민 목록을 이어서 불러오지 못했어요.', 0);
    seenCursors.add(cursor);
    page = await getQuestProgress(islandId, questId, occurrenceId, cursor);
    for (const member of page.members)
      if (!seenMembers.has(member.userId)) {
        seenMembers.add(member.userId);
        members.push(member);
      }
  }
  return { ...first, members, nextCursor: null };
}

/** 쓰기 의도 슬롯 — key 는 페이로드(의도)가 같을 때만 유지된다. */
type IntentSlot = { key: string; payload: string; flight: Promise<unknown> | null };

export function useBoardNotices({
  active,
  scopeKey,
  onLoaded,
}: {
  active: boolean;
  scopeKey: string;
  onLoaded?: (snapshot: BoardLoadedSnapshot) => void;
}) {
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const [state, setState] = useState<BoardNoticesState>(EMPTY);
  // 액션 콜백이 클로저의 옛 state 를 읽지 않도록 최신값을 거울에 둔다.
  const stateRef = useRef(state);
  const set = useCallback((patch: Partial<BoardNoticesState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const mounted = useRef(false);
  // 범위·언마운트 fence — effect 가 새로 돌거나 cleanup 될 때마다 올라간다.
  const epoch = useRef(0);
  // select 경합 fence — 마지막으로 고른 공지만 detail 로 적용된다.
  const selectSeq = useRef(0);
  // 퀘스트 상세도 같은 규칙 — 마지막으로 연 회차만 questDetail 로 적용된다.
  const questSeq = useRef(0);
  const intents = useRef(new Map<string, IntentSlot>());
  // 로드된 공지가 속한 서버 페이지의 시작 커서 — 댓글 성공 후 정확한 페이지에서 정본 카운트를 읽는다.
  const noticePageCursors = useRef(new Map<string, string | null>());
  // 캐시된 섬 데이터가 어느 epoch·세대에서 왔는지 — 계정/범위 교체 직후 리렌더 전에
  // 잡힌 옛 콜백이 옛 islandId 를 새 계정 토큰으로 보내는 것을 막는다.
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

  const load = useCallback(async () => {
    if (!mounted.current || !active) return;
    const e = ++epoch.current;
    const generation = sessionGeneration();
    set({ ...EMPTY, loading: true });
    try {
      const board = await getBoard();
      if (!alive(e, generation)) return;
      proven.current = { epoch: e, generation };
      noticePageCursors.current = new Map(board.notices.items.map((item) => [item.id, null]));
      set({
        islandId: board.island.id,
        islandRole: board.island.role,
        items: board.notices.items,
        nextCursor: board.notices.nextCursor,
        quests: board.quests.items,
        wallets: board.wallets,
        loading: false,
        error: null,
      });
      onLoadedRef.current?.({ islandId: board.island.id, ...board.notices });
    } catch (error) {
      if (!alive(e, generation)) return;
      set({ loading: false, error: error as ApiError });
    }
  }, [active, alive, set]);

  const loadMore = useCallback(async () => {
    const { islandId, nextCursor, loading, loadingMore } = stateRef.current;
    if (
      !mounted.current ||
      !active ||
      !islandId ||
      nextCursor === null ||
      loading ||
      loadingMore ||
      !cached()
    )
      return;
    const e = epoch.current;
    const generation = sessionGeneration();
    set({ loadingMore: true });
    try {
      const page = await listNotices(islandId, nextCursor);
      if (!alive(e, generation)) return;
      // 커서 경계에서 같은 항목이 겹쳐 와도 id 로 한 번만 둔다.
      const seen = new Set(stateRef.current.items.map((i) => i.id));
      const newItems = page.items.filter((i) => !seen.has(i.id));
      for (const item of newItems) noticePageCursors.current.set(item.id, nextCursor);
      set({
        items: [...stateRef.current.items, ...newItems],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
      onLoadedRef.current?.({
        islandId,
        items: stateRef.current.items,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      if (!alive(e, generation)) return;
      set({ loadingMore: false, error: error as ApiError });
    }
  }, [active, alive, cached, set]);

  const select = useCallback(
    async (id: string | null) => {
      const seq = ++selectSeq.current;
      if (id === null) {
        set({ detail: null, detailLoading: false, detailError: null, loadingMoreComments: false });
        return;
      }
      const { islandId } = stateRef.current;
      if (!mounted.current || !active || !islandId || !cached()) return;
      const e = epoch.current;
      const generation = sessionGeneration();
      // 다른 공지를 여는 순간 옛 댓글 페이징은 죽는다 — 플래그도 풀어 새 공지 페이징을 막지 않게 한다.
      set({ detail: null, detailLoading: true, detailError: null, loadingMoreComments: false });
      try {
        const detail = await getNotice(islandId, id);
        if (!alive(e, generation) || seq !== selectSeq.current) return;
        set({ detail, detailLoading: false });
      } catch (error) {
        if (!alive(e, generation) || seq !== selectSeq.current) return;
        set({ detailLoading: false, detailError: error as ApiError });
      }
    },
    [active, alive, cached, set],
  );

  const loadMoreComments = useCallback(async () => {
    const { islandId, detail, loadingMoreComments } = stateRef.current;
    // 재진입 차단 — 같은 커서로 동시에 나간 두 요청이 서로를 되감는 일이 없다.
    if (
      !mounted.current ||
      !active ||
      !islandId ||
      !detail ||
      detail.nextCommentsCursor === null ||
      loadingMoreComments ||
      !cached()
    )
      return;
    const e = epoch.current;
    const generation = sessionGeneration();
    const seq = selectSeq.current;
    set({ loadingMoreComments: true });
    try {
      const next = await getNotice(islandId, detail.id, detail.nextCommentsCursor);
      // 그 사이 다른 공지를 골랐으면 이 응답은 버린다.
      if (!alive(e, generation) || seq !== selectSeq.current) return;
      const current = stateRef.current.detail;
      if (!current || current.id !== detail.id) return;
      const seen = new Set(current.comments.map((c) => c.id));
      set({
        detail: {
          ...next,
          comments: [...current.comments, ...next.comments.filter((c) => !seen.has(c.id))],
        },
        loadingMoreComments: false,
      });
    } catch (error) {
      if (!alive(e, generation) || seq !== selectSeq.current) return;
      set({ loadingMoreComments: false, detailError: error as ApiError });
    }
  }, [active, alive, cached, set]);

  // 쓰기 여정의 재조회는 「조용한 폐기」가 아니라 실패다 — stale 을 그대로 성공 처리하면
  // 호출부가 새 계정 화면에서 초안을 지우거나 뒤로 가기를 실행한다. await 전후로 검사한다.
  const refreshList = useCallback(
    async (e: number, generation: number) => {
      if (!alive(e, generation)) throw stale();
      const board = await getBoard();
      if (!alive(e, generation)) throw stale();
      proven.current = { epoch: e, generation };
      noticePageCursors.current = new Map(board.notices.items.map((item) => [item.id, null]));
      set({
        islandId: board.island.id,
        islandRole: board.island.role,
        items: board.notices.items,
        nextCursor: board.notices.nextCursor,
        quests: board.quests.items,
        wallets: board.wallets,
      });
      onLoadedRef.current?.({ islandId: board.island.id, ...board.notices });
    },

    [alive, set],
  );

  // 열려 있는 상세가 그 공지일 때만 서버 첫 페이지로 갈아 끼운다.
  const refreshDetail = useCallback(
    async (e: number, generation: number, islandId: string, noticeId: string) => {
      if (!alive(e, generation)) throw stale();
      if (stateRef.current.detail?.id !== noticeId) return; // 열려 있지 않으면 갱신할 것도 없다
      const next = await getNotice(islandId, noticeId);
      if (!alive(e, generation)) throw stale();
      if (stateRef.current.detail?.id === noticeId) set({ detail: next });
    },

    [alive, set],
  );

  // 공지 상세에는 전체 댓글 수가 없으므로, 댓글 작성 뒤 해당 공지가 있던 목록 페이지를 다시 읽는다.
  const refreshNoticePage = useCallback(
    async (e: number, generation: number, islandId: string, noticeId: string) => {
      if (!alive(e, generation)) throw stale();
      const cursor = noticePageCursors.current.get(noticeId);
      if (cursor === undefined) return;
      const page = await listNotices(islandId, cursor ?? undefined);
      if (!alive(e, generation)) throw stale();
      const updated = page.items.find((item) => item.id === noticeId);
      if (!updated) return;
      const items = stateRef.current.items.map((item) => (item.id === noticeId ? updated : item));
      set({ items });
      onLoadedRef.current?.({
        islandId,
        items,
        nextCursor: stateRef.current.nextCursor,
      });
    },
    [alive, set],
  );

  /** 퀘스트 상세 — 회차별 라우트 키인 occurrenceId로 정확한 목록 항목을 찾는다. */
  const selectQuest = useCallback(
    async (occurrenceId: string | null) => {
      const seq = ++questSeq.current;
      if (occurrenceId === null) {
        set({ questDetail: null, questDetailLoading: false, questDetailError: null });
        return;
      }
      const { islandId, quests } = stateRef.current;
      if (!mounted.current || !active || !islandId || !cached()) return;
      const e = epoch.current;
      const generation = sessionGeneration();
      set({ questDetail: null, questDetailLoading: true, questDetailError: null });
      try {
        const item = quests.find((q) => q.occurrenceId === occurrenceId);
        // 목록에 없는 id — 회차가 굴러 헤더가 바뀐 옛 라우트다. GET 을 만들 수 없으니
        // 클라이언트 오류로 표시해 빙글거리는 스피너 대신 재시도를 보여 준다.
        if (!item) throw new ApiError('QUEST_GONE', '이 퀘스트 회차는 지나갔어요.', 0);
        const detail = await getAllQuestProgress(islandId, item.id, item.occurrenceId);
        if (!alive(e, generation) || seq !== questSeq.current) return;
        set({ questDetail: detail, questDetailLoading: false });
      } catch (error) {
        if (!alive(e, generation) || seq !== questSeq.current) return;
        set({ questDetailLoading: false, questDetailError: error as ApiError });
      }
    },
    [active, alive, cached, set],
  );

  // 열려 있는 퀘스트 상세가 그 퀘스트일 때만 progress 로 갈아 끼운다.
  const refreshQuestDetail = useCallback(
    async (e: number, generation: number, islandId: string, questId: string) => {
      if (!alive(e, generation)) throw stale();
      const open = stateRef.current.questDetail;
      if (open?.id !== questId) return;
      const next = await getAllQuestProgress(islandId, questId, open.occurrenceId);
      if (!alive(e, generation)) throw stale();
      if (stateRef.current.questDetail?.id === questId) set({ questDetail: next });
    },
    [alive, set],
  );

  /**
   * 쓰기 한 건을 의도 슬롯 위에서 돌린다.
   * - 진행 중인 같은 슬롯이 있으면 그 promise 를 돌려준다(중복 탭 → 요청 1건).
   * - 실패하면 key 는 남겨 재시도가 같은 key 로 가고, 성공(write+GET refresh)이면 슬롯을 놓는다.
   * - 페이로드가 바뀐 호출은 새 의도로 보고 새 key 를 민다.
   */
  const runWrite = useCallback(
    <T>(
      slotId: string,
      payload: string,
      write: (key: string) => Promise<T>,
      after: (result: T) => Promise<void>,
    ): Promise<T> => {
      const prev = intents.current.get(slotId);
      if (prev?.flight) {
        // 같은 본문의 중복 탭만 진행 중인 promise 를 공유한다. 다른 본문은 거절해
        // 호출부의 새 초안이 이전 의도의 성공으로 지워지지 않게 한다.
        if (prev.payload === payload) return prev.flight as Promise<T>;
        return Promise.reject(
          new ApiError(CLIENT_WRITE_IN_PROGRESS, '이전 저장이 끝나는 중이에요.', 0),
        );
      }
      const slot: IntentSlot =
        prev && prev.payload === payload ? prev : { key: uuid(), payload, flight: null };
      const flight = (async () => {
        const result = await write(slot.key);
        await after(result);
        // 마지막 await 뒤 continuation 도 별도 마이크로태스크다 — 그 사이 세대가 바뀌어
        // 같은 slotId 의 새 의도가 들어왔을 수 있으니 자기 슬롯일 때만 놓는다.
        if (intents.current.get(slotId) === slot) intents.current.delete(slotId);
        return result;
      })();
      slot.flight = flight;
      intents.current.set(slotId, slot);
      // 실패하면 key 는 남기고 flight 만 푼다 — 응답 유실 재시도가 같은 key 로 간다.
      flight.catch(() => {
        if (intents.current.get(slotId) === slot) slot.flight = null;
      });
      return flight;
    },
    [],
  );

  /** 쓰기는 화면이 살아 있고 섬이 확정됐을 때만 — 아니면 던져서 호출부 초안을 보존한다. */
  const writable = useCallback((): string => {
    const { islandId } = stateRef.current;
    if (!mounted.current || !active || !islandId)
      throw new ApiError(CLIENT_INACTIVE, '지금은 게시판에 쓸 수 없어요.', 0);
    // 섬 id 가 옛 계정·옛 범위의 캐시면 새 세대 토큰으로 보내지 않는다.
    if (!cached()) throw stale();
    return islandId;
  }, [active, cached]);

  const createNotice = useCallback(
    async (body: { title: string; body: string }): Promise<NoticeWriteResult> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      return runWrite(
        `create:${islandId}`,
        JSON.stringify(body),
        (key) => postNotice(islandId, body, key),
        () => refreshList(e, generation),
      );
    },
    [writable, runWrite, refreshList],
  );

  const updateNotice = useCallback(
    async (id: string, body: { title?: string; body?: string }): Promise<NoticeWriteResult> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      return runWrite(
        `update:${id}`,
        JSON.stringify(body),
        (key) => patchNotice(islandId, id, body, key),
        async () => {
          await refreshList(e, generation);
          await refreshDetail(e, generation, islandId, id);
        },
      );
    },
    [writable, runWrite, refreshList, refreshDetail],
  );

  const deleteNotice = useCallback(
    async (id: string): Promise<NoticeDeleted> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      return runWrite(
        `delete:${id}`,
        id,
        (key) => delNotice(islandId, id, key),
        async () => {
          await refreshList(e, generation);
          // await 뒤 continuation 은 별도 마이크로태스크다 — 그 사이 세대가 바뀌었으면
          // 열린 상세를 비우지 않고 stale 로 던져 호출부가 성공 처리하지 않게 한다.
          if (!alive(e, generation)) throw stale();
          // 삭제된 공지의 상세가 열려 있으면 닫는다 — 서버에 없는 공지를 계속 보여주지 않는다.
          if (stateRef.current.detail?.id === id) set({ detail: null });
        },
      );
    },
    [writable, runWrite, refreshList, alive, set],
  );

  const addComment = useCallback(
    async (noticeId: string, text: string): Promise<CommentCreated> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      return runWrite(
        `comment:${noticeId}`,
        text,
        (key) => postComment(islandId, noticeId, { text }, key),
        async () => {
          if (!alive(e, generation)) throw stale();
          await refreshNoticePage(e, generation, islandId, noticeId);
          await refreshDetail(e, generation, islandId, noticeId);
        },
      );
    },
    [writable, runWrite, refreshNoticePage, refreshDetail, alive],
  );

  /** 퀘스트 만들기 — 본문·권한 검증은 서버가 한다(quests.ts 의 허용 키만 보낸다). */
  const createQuest = useCallback(
    async (body: QuestCreateBody): Promise<QuestCreated> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      return runWrite(
        `quest-create:${islandId}`,
        JSON.stringify(body),
        (key) => postQuest(islandId, body, key),
        () => refreshList(e, generation),
      );
    },
    [writable, runWrite, refreshList],
  );

  /** 퀘스트 수정 — 공개 PATCH 는 title/targetMinutes 만 받는다(quests.ts 계약). */
  const updateQuest = useCallback(
    async (id: string, body: QuestUpdateBody): Promise<QuestUpdated> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      return runWrite(
        `quest-update:${id}`,
        JSON.stringify({ id, ...body }),
        (key) => patchQuest(islandId, id, body, key),
        async () => {
          await refreshList(e, generation);
          await refreshQuestDetail(e, generation, islandId, id);
        },
      );
    },
    [writable, runWrite, refreshList, refreshQuestDetail],
  );

  /**
   * 개인 몫 수령 — 본문은 {occurrenceId, expectedVersion} 두 키뿐이고 지급량은 서버가 판정한다.
   * 성공하면 refreshList 로 목록·지갑을 다시 읽는다(로컬 가산 금지).
   * 403/409 실패는 권한·회차 버전이 바뀌었다는 뜻이라 목록을 다시 읽어 새 버전을 맞춘다.
   */
  const claimQuest = useCallback(
    async (quest: QuestItem): Promise<QuestClaimed> => {
      const islandId = writable();
      const e = epoch.current;
      const generation = sessionGeneration();
      const body = { occurrenceId: quest.occurrenceId, expectedVersion: quest.version };
      try {
        return await runWrite(
          `claim:${quest.id}`,
          JSON.stringify(body),
          (key) => postClaim(islandId, quest.id, body, key),
          async () => {
            await refreshList(e, generation);
            await refreshQuestDetail(e, generation, islandId, quest.id);
          },
        );
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 403 || error.status === 409) &&
          alive(e, generation)
        )
          await refreshList(e, generation).catch(() => {});
        throw error;
      }
    },
    [writable, runWrite, refreshList, refreshQuestDetail, alive],
  );

  // 선언 순서가 곧 실행 순서다 — load effect 보다 먼저 mounted 를 세운다.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 세대는 구독이 없어 렌더 시점에 읽어 의존성에 태운다 — 세션 교체를 일으킨 렌더에서
  // 이 effect 가 다시 돌며 옛 계정 데이터를 지운다. 늦은 응답은 alive fence 가 버린다.
  const generation = sessionGeneration();
  useEffect(() => {
    epoch.current += 1;
    // 범위·계정이 바뀌면 미해결 쓰기 의도도 새 범위로 넘기지 않는다.
    intents.current.clear();
    noticePageCursors.current.clear();
    if (!active) set(EMPTY);
    else load().catch(() => {});
    // 언마운트·의존성 교체로 돌아온 응답이 새 범위를 덮지 못하게 epoch 를 올린다.
    return () => {
      epoch.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeKey·generation 은 재시작 신호다.
  }, [active, scopeKey, generation, load]);

  return {
    ...state,
    retry: load,
    loadMore,
    select,
    loadMoreComments,
    createNotice,
    updateNotice,
    deleteNotice,
    addComment,
    selectQuest,
    createQuest,
    updateQuest,
    claimQuest,
  };
}
