import { useEffect, useRef } from 'react';
import type { LibraryScreen } from '@/services/api/records';

/** 실제 도서관 진입 또는 화면이 성공적으로 표시한 서버 관측값만 확인 처리한다. */
export function useBuildingIndicatorSeen({
  active,
  islandId,
  screen,
  onLoaded,
}: {
  active: boolean;
  islandId: string | null;
  screen: LibraryScreen | null;
  onLoaded: (screen: LibraryScreen | null) => void;
}) {
  const callback = useRef(onLoaded);
  const dispatchedScreens = useRef(new WeakMap<LibraryScreen, Set<string>>());
  callback.current = onLoaded;

  useEffect(() => {
    if (!active || !islandId) return;
    // 건물 진입은 서버 정본을 새로 읽어 기준점을 저장한다. 하위 화면은 완성된 화면
    // snapshot을 넘겨 실제 표시한 데이터와 일치시킨다.
    if (!screen) {
      callback.current(null);
      return;
    }
    if (
      screen.island.id !== islandId ||
      screen.statisticsAvailability !== 'available' ||
      (screen.missingFragments?.length ?? 0) > 0
    )
      return;
    const seenIslands = dispatchedScreens.current.get(screen) ?? new Set<string>();
    if (seenIslands.has(islandId)) return;
    seenIslands.add(islandId);
    dispatchedScreens.current.set(screen, seenIslands);
    callback.current(screen);
  }, [active, islandId, screen]);
}
