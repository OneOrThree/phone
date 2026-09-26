import { useEffect, useRef } from 'react';
import type { LibraryScreen } from '@/services/api/records';

/** 실제 도서관 화면이 성공적으로 표시한 서버 관측값만 확인 처리한다. */
export function useBuildingIndicatorSeen({
  active,
  islandId,
  screen,
  onLoaded,
}: {
  active: boolean;
  islandId: string | null;
  screen: LibraryScreen | null;
  onLoaded: (screen: LibraryScreen) => void;
}) {
  const callback = useRef(onLoaded);
  callback.current = onLoaded;

  useEffect(() => {
    if (
      !active ||
      !islandId ||
      !screen ||
      screen.island.id !== islandId ||
      screen.statisticsAvailability !== 'available' ||
      (screen.missingFragments?.length ?? 0) > 0
    )
      return;
    callback.current(screen);
  }, [active, islandId, screen]);
}
