import { useEffect, useState } from 'react';

// 집중 라이브 틱업 공용 시계 — active 일 때만 1초 간격으로 now(ms epoch)를 갱신한다.
// 656(집중 세션 친구 그리드)·658(친구 탭 그리드)이 공용. active=false 면 인터벌을 돌리지 않는다.
export function useLiveFocusClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
