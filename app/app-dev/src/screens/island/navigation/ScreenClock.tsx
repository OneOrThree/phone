import { Ticking } from '@/hooks/useNow';
import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import React from 'react';

// 초 단위로 흐르는 시간을 쓰는 화면(집중 경과·실시간 주민 시간·공사 완공 확인)만 ms 마다 다시 그린다 —
// App 은 분이 바뀔 때만 다시 그린다(GROMO-2372). e.now 와 이 시계 중 늦은 값을 넘겨 시각을 직접 주는 호출부도 그대로 둔다.
export function everySecond(
  base: ScreenEnvironment,
  screen: (timed: ScreenEnvironment) => React.ReactNode,
  ms: number | null = 1000,
) {
  return (
    <Ticking ms={ms}>{(now) => screen({ ...base, now: Math.max(base.now ?? 0, now) })}</Ticking>
  );
}
