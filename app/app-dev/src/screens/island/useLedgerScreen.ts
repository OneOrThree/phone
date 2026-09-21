/**
 * 회관 「공동 가계부」 화면 전용 view model (GROMO-2011).
 *
 * 데이터는 전부 서버다 — 로컬 `i.ledger` 문자열·로컬 잔액 합산과 무관하다:
 *  - 공동 잔액 정본은 `GET /screens/town-hall` 의 `wallets.villagePoints` 다 — `wallets.fish` 는
 *    개인 지갑이라 이 화면에 쓰지 않는다(이 화면에서 원장 합산으로 만들지도 않는다).
 *  - 이번 KST 달·무필터 첫 쪽은 `town-hall` 집계의 필수 `ledger` 조각이다(왕복을 늘리지 않는다).
 *  - 과거 달·적립/지출 탭·다음 쪽은 `GET /islands/{islandId}/resources/ledger` — 서명 커서가
 *    섬·월·방향에 묶이므로 scope 가 바뀌면 커서와 items 를 버리고 첫 쪽부터 다시 받는다.
 *  - 서버 `island.id` 는 town-hall 응답에서 배운다 — `islandId` 입력은 지금 로컬 섬 id 라
 *    fetch 에 쓰지 않고 「보고 있는 섬이 바뀌었다」는 scope 리셋 신호로만 쓴다(GROMO-2007 이
 *    서버 id 를 싣기 시작하면 같은 계약이다).
 *
 * 경합: scope·섬·`active` 가 바뀔 때마다 요청 세대를 올리고, 응답·에러 적용 전에 세대와
 * `sessionGeneration()` 을 다시 본다 — 늦게 도착한 옛 scope/옛 계정 응답은 버린다(세션 세대
 * 비교는 client 의 stale 계약과 같은 fence 다). 실패를 빈 배열로 접지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import { getLedger, getTownHall, type LedgerEntry, type LedgerPage } from '@/services/api/townHall';

export type LedgerTab = 'balance' | 'earn' | 'spend';

/** `YYYY-MM` + delta 달 — KST 축은 문자열만 옮기면 되므로 UTC 연산으로 충분하다. */
export const shiftMonth = (ym: string, delta: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export interface LedgerScreenState {
  /** 보고 있는 달 `YYYY-MM` (KST). */
  month: string;
  /** 이번 달로부터의 오프셋(0=이번 달, 음수만). */
  offset: number;
  /** 다음 달로 갈 수 있는가(이번 달을 넘지 않는다). */
  canNext: boolean;
  prevMonth: () => void;
  nextMonth: () => void;
  tab: LedgerTab;
  setTab: (tab: LedgerTab) => void;
  /** 첫 쪽 상태 — loading 이면 rows 없음, error 면 error+retry. */
  status: 'loading' | 'ready' | 'error';
  error: ApiError | null;
  items: LedgerEntry[];
  /** 섬 공동 지갑 정본(현재 잔액, `wallets.villagePoints`). 첫 조회 전엔 null. */
  villagePoints: number | null;
  /** 보고 있는 달 전체 합계 — 페이지·방향 필터와 무관한 서버 값. */
  earnedTotal: number;
  spentTotal: number;
  nextCursor: string | null;
  loadingMore: boolean;
  /** 다음 쪽 실패 — 첫 쪽 error 와 구분되며 기존 rows 는 유지된다. */
  moreError: ApiError | null;
  loadMore: () => void;
  /** 같은 scope 의 첫 쪽을 다시 읽는다. retry·refresh 는 같은 동작이다. */
  retry: () => void;
  refresh: () => void;
}

export function useLedgerScreen({
  active,
  islandId,
  currentMonth,
}: {
  /** 이 화면이 보이고 주민일 때만 true — 방문자·다른 route 에서는 호출이 0회다. */
  active: boolean;
  /** scope 리셋 신호로만 쓰는 화면의 섬 식별자(현재는 로컬 id). */
  islandId: string;
  /** KST 이번 달 `YYYY-MM` — Hall 의 `dayKey(now).slice(0,7)` 과 같은 축. */
  currentMonth: string;
}): LedgerScreenState {
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<LedgerTab>('balance');
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [items, setItems] = useState<LedgerEntry[]>([]);
  const [villagePoints, setVillagePoints] = useState<number | null>(null);
  const [earnedTotal, setEarnedTotal] = useState(0);
  const [spentTotal, setSpentTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiError | null>(null);
  // 진행 중 요청의 세대 — scope 가 바뀌면 올라가서 늦은 응답을 버린다
  const req = useRef(0);
  // town-hall 응답에서 배운 서버 섬 id (getLedger 의 path 에 쓰는 값)
  const serverIsland = useRef<string | null>(null);
  const islandKey = useRef(islandId);
  // 마지막으로 조회한 세션 세대 — 계정이 바뀌면 서버 섬 id·지갑도 전부 남의 것이다
  const accountGen = useRef(sessionGeneration());

  const month = shiftMonth(currentMonth, offset);
  const direction = tab === 'balance' ? undefined : tab;
  // 렌더 시점의 세션 세대를 deps 에 둔다 — 계정이 갈리고 화면이 다시 그려지면 로컬 islandId 가
  // 같아도 effect 가 다시 돌아 서버 섬 id·잔액·rows·cursor 를 전부 버리고 새 계정으로 묶는다.
  const session = sessionGeneration();

  useEffect(() => {
    if (!active) {
      // 비활성 동안 계정이 갈릴 수 있다 — 돌아오는 프레임에 옛 rows·잔액이 보이지 않게 비운다
      req.current += 1;
      serverIsland.current = null;
      islandKey.current = islandId;
      accountGen.current = sessionGeneration();
      setStatus('loading');
      setError(null);
      setMoreError(null);
      setLoadingMore(false);
      setItems([]);
      setNextCursor(null);
      setVillagePoints(null);
      setEarnedTotal(0);
      setSpentTotal(0);
      return;
    }
    if (islandKey.current !== islandId || accountGen.current !== session) {
      islandKey.current = islandId;
      accountGen.current = session;
      serverIsland.current = null;
      setVillagePoints(null);
    }
    const gen = ++req.current;
    const stale = () => gen !== req.current || session !== sessionGeneration();
    setError(null);
    setMoreError(null);
    setLoadingMore(false);
    setStatus('loading');
    setItems([]);
    setNextCursor(null);
    setEarnedTotal(0);
    setSpentTotal(0);
    (async () => {
      try {
        let page: LedgerPage;
        const isDefaultScope = month === currentMonth && direction === undefined;
        if (isDefaultScope || !serverIsland.current) {
          // 기본 scope 는 집계 조각으로 한 왕복에 잔액까지 받고, 비기본 scope 인데 서버 섬 id 를
          // 모르면 먼저 town-hall 로 배운다(잔액 갱신은 덤).
          const screen = await getTownHall();
          if (stale()) return;
          serverIsland.current = screen.island.id;
          setVillagePoints(screen.wallets.villagePoints);
          if (isDefaultScope) {
            page = screen.ledger;
          } else {
            page = await getLedger(screen.island.id, { month, direction });
            if (stale()) return;
          }
        } else {
          page = await getLedger(serverIsland.current, { month, direction });
          if (stale()) return;
        }
        setEarnedTotal(page.earnedTotal);
        setSpentTotal(page.spentTotal);
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setStatus('ready');
      } catch (thrown) {
        // 옛 scope·옛 계정의 실패도 새 화면에 적지 않는다 — stale 은 조용히 버린다
        if (stale()) return;
        setError(thrown as ApiError);
        setStatus('error');
      }
    })();
    // unmount·dep 변경 모두 진행 중 응답을 버린다
    return () => {
      req.current += 1;
    };
  }, [active, islandId, month, direction, currentMonth, nonce, session]);

  // 이 렌더가 만든 콜백의 scope 세대 — unmount·scope·계정 변경 뒤 캡처된 loadMore 를 죽이는 값이다
  const renderGen = req.current;
  const loadMore = useCallback(() => {
    const cursor = nextCursor;
    const island = serverIsland.current;
    if (!cursor || !island || loadingMore || status !== 'ready') return;
    // effect cleanup·재조회는 req 를 올린다 — 옛 렌더의 콜백은 옛 cursor 를 들고 있으므로 버린다.
    // 세대만 갈리고 재조회가 아직이면 serverIsland·cursor 도 남의 계정 것이다 — 새 토큰으로 보내지 않는다
    if (renderGen !== req.current || accountGen.current !== sessionGeneration()) return;
    // scope 세대를 올리지 않는다 — 이 요청이 끝나기 전에 scope 가 바뀌면 effect 가 req 를
    // 올려 이 응답은 버려진다
    const gen = req.current;
    const callSession = sessionGeneration();
    setLoadingMore(true);
    setMoreError(null);
    getLedger(island, { month, direction, cursor })
      .then((page) => {
        if (gen !== req.current || callSession !== sessionGeneration()) return;
        // id 기준 중복 제거 — 서명 커서 keyset 이 겹치지 않는 게 정상이지만 방어한다
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...page.items.filter((x) => !seen.has(x.id))];
        });
        setEarnedTotal(page.earnedTotal);
        setSpentTotal(page.spentTotal);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      })
      .catch((thrown) => {
        if (gen !== req.current || callSession !== sessionGeneration()) return;
        setMoreError(thrown as ApiError);
        setLoadingMore(false);
      });
  }, [nextCursor, loadingMore, status, month, direction, renderGen]);

  return {
    month,
    offset,
    canNext: offset < 0,
    prevMonth: useCallback(() => setOffset((n) => n - 1), []),
    nextMonth: useCallback(() => setOffset((n) => Math.min(0, n + 1)), []),
    tab,
    setTab,
    status,
    error,
    items,
    villagePoints,
    earnedTotal,
    spentTotal,
    nextCursor,
    loadingMore,
    moreError,
    loadMore,
    retry: useCallback(() => setNonce((n) => n + 1), []),
    refresh: useCallback(() => setNonce((n) => n + 1), []),
  };
}
