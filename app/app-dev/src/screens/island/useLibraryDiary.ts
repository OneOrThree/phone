/**
 * 도서관 일기장(내 일기장·이웃들의 일기장) 화면 전용 view model (GROMO-2018).
 *
 * 데이터는 전부 서버다 — 로컬 `s.records`·`screenDays`·`earnedBy` 예시값과 로컬 합산을
 * 쓰지 않는다:
 *  - 진입 시 `GET /screens/library` 한 번으로 서버 섬 id·`statisticsAvailability`·
 *    이번 UTC 주 scope=me 두 통계 조각·`fishEarnings` 를 받는다.
 *  - 기간(일·주·월)·offset 이 이번 UTC 주를 벗어나거나 이웃 장이면 도메인 GET
 *    (`…/statistics/focus` · `…/statistics/screen-time`)을 `from`·`to` UTC 날짜로 부른다.
 *  - scope=island 는 주민 배열 한 번에 온다 — 주민 탭 전환은 다시 부르지 않는다.
 *  - focus 의 `nextCursor` 는 끝까지 잇는다(scope=me records·scope=island members).
 *
 * 경합: 조합이 바뀔 때마다 요청 세대를 올리고 적용 전에 세대·`sessionGeneration()` 을 다시
 * 본다. 실패를 빈 기록으로 접지 않는다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/services/api/client';
import { sessionGeneration } from '@/services/api/session';
import {
  getFocusStatistics,
  getLibraryScreen,
  getScreenTimeStatistics,
  utcPeriodRange,
  type FocusStatsIsland,
  type FocusStatsMe,
  type LibraryScreen,
  type ScreenStatsIsland,
  type ScreenStatsMe,
  type StatisticsQuery,
} from '@/services/api/records';

export type DiaryPeriod = '일' | '주' | '월';

// ponytail: 정원 15·기록 30/쪽이라 정상 계약에선 1쪽이다 — 서버가 커서를 계속 주는 비정상을
// 32쪽에서 끊는다(homeSnapshot 의 MAX_MEMBER_PAGES 와 같은 최후 방어선).
const MAX_PAGES = 32;

export interface LibraryDiaryState {
  /** mock 이면 호출부가 로컬 상태로 그린다. locked 는 도서관 미완공(facility_locked). */
  status: 'mock' | 'loading' | 'locked' | 'ready' | 'error';
  error: ApiError | null;
  retry: () => void;
  /** `/screens/library` 응답 — 섬 id·availability·missingFragments·fishEarnings. */
  screen: LibraryScreen | null;
  /** 현재 기간의 scope=me 조각. 보고 있는 장이 아니면 지난 값이 남을 수 있다. */
  focusMe: FocusStatsMe | null;
  screenMe: ScreenStatsMe | null;
  /** 현재 기간의 scope=island 조각 — 주민 전원. */
  focusIsland: FocusStatsIsland | null;
  screenIsland: ScreenStatsIsland | null;
}

export function useLibraryDiary({
  active,
  nb,
  page,
  period,
  offset,
  combined = false,
  rangeOverride,
  islandKey,
}: {
  /** 서버 모드에서만 true — 모크(review/demo) 화면은 호출부가 로컬로 그린다. */
  active: boolean;
  /** 이웃들의 일기장이면 true — scope=island 를 읽는다. */
  nb: boolean;
  /** 0 집중 · 1 스크린타임 · 2 물고기(nb 만). */
  page: number;
  period: DiaryPeriod;
  offset: number;
  /** 달력·이웃 기록은 집중과 폰 사용을 한 번에 표시한다. */
  combined?: boolean;
  rangeOverride?: { from: string; to: string };
  islandKey?: string;
}): LibraryDiaryState {
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<LibraryDiaryState['status']>(active ? 'loading' : 'mock');
  const [error, setError] = useState<ApiError | null>(null);
  const [screen, setScreen] = useState<LibraryScreen | null>(null);
  const [focusMe, setFocusMe] = useState<FocusStatsMe | null>(null);
  const [screenMe, setScreenMe] = useState<ScreenStatsMe | null>(null);
  const [focusIsland, setFocusIsland] = useState<FocusStatsIsland | null>(null);
  const [screenIsland, setScreenIsland] = useState<ScreenStatsIsland | null>(null);
  const req = useRef(0);
  // nonce(=retry) 단위로 캐시한 진입 집계 — retry 는 화면 조각부터 다시 읽는다
  const libCache = useRef<{
    nonce: number;
    session: number;
    islandKey?: string;
    day: string;
    screen: LibraryScreen;
  } | null>(null);
  const session = sessionGeneration();
  const today = new Date().toISOString().slice(0, 10);
  const from = rangeOverride?.from;
  const to = rangeOverride?.to;

  useEffect(() => {
    if (!active) {
      req.current += 1;
      libCache.current = null;
      setStatus('mock');
      setError(null);
      setScreen(null);
      setFocusMe(null);
      setScreenMe(null);
      setFocusIsland(null);
      setScreenIsland(null);
      return;
    }
    const gen = ++req.current;
    const stale = () => gen !== req.current || session !== sessionGeneration();
    setError(null);
    setStatus('loading');
    setFocusMe(null);
    setScreenMe(null);
    setFocusIsland(null);
    setScreenIsland(null);
    (async () => {
      try {
        const cache = libCache.current;
        let lib =
          cache?.nonce === nonce &&
          cache.session === session &&
          cache.islandKey === islandKey &&
          cache.day === today
            ? cache.screen
            : null;
        if (!lib) {
          lib = await getLibraryScreen();
          if (stale()) return;
          libCache.current = { nonce, session, islandKey, day: today, screen: lib };
          setScreen(lib);
        }
        if (lib.statisticsAvailability === 'facility_locked') {
          setStatus('locked');
          return;
        }
        const range = from && to ? { from, to } : utcPeriodRange(period, offset);
        // 이번 UTC 주·scope=me 는 진입 집계의 조각을 그대로 쓴다(같은 축·같은 관측).
        // missingFragments 에 든 조각은 서버가 아직 만들지 않은 것 — 다시 묻지 않고
        // null 로 둬서 UI 가 「준비 중」을 그리게 한다.
        const firstWeek = !from && period === '주' && offset === 0;
        const missing = lib.missingFragments ?? [];
        if (combined) {
          if (nb) {
            const [focus, usage] = await Promise.all([
              collectFocus(lib.island.id, { ...range, scope: 'island' }, stale),
              getScreenTimeStatistics(lib.island.id, { ...range, scope: 'island' }),
            ]);
            if (stale() || focus.scope !== 'island') return;
            setFocusIsland(focus);
            setScreenIsland(usage);
          } else {
            const [focus, usage] = await Promise.all([
              firstWeek && missing.includes('focusStatistics') && !lib.focusStatistics
                ? null
                : firstWeek && lib.focusStatistics
                  ? lib.focusStatistics
                  : collectFocus(lib.island.id, { ...range, scope: 'me' }, stale),
              firstWeek && missing.includes('screenTimeStatistics') && !lib.screenTimeStatistics
                ? null
                : firstWeek && lib.screenTimeStatistics
                  ? lib.screenTimeStatistics
                  : getScreenTimeStatistics(lib.island.id, { ...range, scope: 'me' }),
            ]);
            if (stale()) return;
            setFocusMe(focus?.scope === 'me' ? focus : null);
            setScreenMe(usage);
          }
        } else if (!nb) {
          if (page === 0) {
            if (!(firstWeek && !lib.focusStatistics && missing.includes('focusStatistics'))) {
              const stats =
                firstWeek && lib.focusStatistics
                  ? lib.focusStatistics
                  : await collectFocus(lib.island.id, { ...range, scope: 'me' }, stale);
              if (stale() || stats.scope !== 'me') return;
              setFocusMe(stats);
            }
          } else if (!(
            firstWeek &&
            !lib.screenTimeStatistics &&
            missing.includes('screenTimeStatistics')
          )) {
            const stats =
              firstWeek && lib.screenTimeStatistics
                ? lib.screenTimeStatistics
                : await getScreenTimeStatistics(lib.island.id, { ...range, scope: 'me' });
            if (stale() || stats.scope !== 'me') return;
            setScreenMe(stats);
          }
        } else if (page === 0) {
          const stats = await collectFocus(lib.island.id, { ...range, scope: 'island' }, stale);
          if (stale() || stats.scope !== 'island') return;
          setFocusIsland(stats);
        } else if (page === 1) {
          const stats = await getScreenTimeStatistics(lib.island.id, {
            ...range,
            scope: 'island',
          });
          if (stale() || stats.scope !== 'island') return;
          setScreenIsland(stats);
        }
        // page 2(물고기)는 진입 집계의 fishEarnings 조각이 정본이다 — 추가 호출 없음.
        setStatus('ready');
      } catch (thrown) {
        if (stale()) return;
        setError(thrown as ApiError);
        setStatus('error');
      }
    })();
    return () => {
      req.current += 1;
    };
  }, [active, nb, page, period, offset, nonce, session, combined, from, to, islandKey, today]);

  return {
    status,
    error,
    retry: useCallback(() => setNonce((n) => n + 1), []),
    screen,
    focusMe,
    screenMe,
    focusIsland,
    screenIsland,
  };
}

/** records(scope=me)·members(scope=island) 의 nextCursor 를 끝까지 잇는다. */
async function collectFocus(
  islandId: string,
  base: StatisticsQuery,
  stale: () => boolean,
): Promise<FocusStatsMe | FocusStatsIsland> {
  const fetchPage = (cursor?: string) => {
    const next = { ...base, ...(cursor ? { cursor } : {}) };
    return base.scope === 'me'
      ? getFocusStatistics(islandId, { ...next, scope: 'me' })
      : getFocusStatistics(islandId, { ...next, scope: 'island' });
  };
  let page = await fetchPage();
  const pages = [page];
  let cursor = page.nextCursor;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (seen.has(cursor) || pages.length >= MAX_PAGES || stale()) break;
    seen.add(cursor);
    page = await fetchPage(cursor);
    pages.push(page);
    cursor = page.nextCursor;
  }
  if (pages.length === 1) return pages[0];
  const first = pages[0];
  if (first.scope === 'me') {
    return {
      ...first,
      records: pages.flatMap((p) => (p.scope === 'me' ? p.records : [])),
      nextCursor: null,
    };
  }
  return {
    ...first,
    members: pages.flatMap((p) => (p.scope === 'island' ? p.members : [])),
    nextCursor: null,
  };
}
