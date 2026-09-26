import { useEffect, useRef } from 'react';
import { getLibraryScreen, type LibraryScreen } from '@/services/api/records';
import { sessionGeneration } from '@/services/api/session';

/** 도서관 방을 정상적으로 확인했을 때의 서버 관측값만 전달한다. */
export function useBuildingIndicatorSeen({
  active,
  islandId,
  onLoaded,
}: {
  active: boolean;
  islandId: string | null;
  onLoaded: (screen: LibraryScreen) => void;
}) {
  const callback = useRef(onLoaded);
  callback.current = onLoaded;
  const generation = sessionGeneration();

  useEffect(() => {
    if (!active || !islandId) return;
    let live = true;
    getLibraryScreen()
      .then((screen) => {
        if (
          !live ||
          generation !== sessionGeneration() ||
          screen.island.id !== islandId ||
          screen.statisticsAvailability !== 'available' ||
          (screen.missingFragments?.length ?? 0) > 0
        )
          return;
        callback.current(screen);
      })
      .catch(() => {
        // 조회 실패는 확인으로 기록하지 않는다. 다음 진입에서 다시 확인한다.
      });
    return () => {
      live = false;
    };
  }, [active, islandId, generation]);
}
