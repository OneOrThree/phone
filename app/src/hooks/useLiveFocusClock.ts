import { useEffect, useState } from 'react';

// 집중 라이브 틱업 공용 시계 — active 일 때만 1초 간격으로 now(ms epoch)를 갱신한다.
// 656(집중 세션 친구 그리드)·658(친구 탭 그리드)이 공용. active=false 면 인터벌을 돌리지 않는다.
//
// ⚠️ 타이머는 앱 전체에 **하나만** 둔다. 리그 랭킹은 행마다 이 훅을 부르는데(RankRow →
//    LiveFocusTime), 훅마다 setInterval 을 만들면 집중 중인 사람이 많을수록 타이머가 그대로
//    늘어난다 — 봇 190명(티켓 1565) 이후 최대 100개가 동시에 돌았다(GROMO-1572).
//    구독자가 모두 빠지면 타이머도 멈추므로, active=false 의 "인터벌을 안 돌린다"는 성질은 그대로다.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(now: number) => void>();

function subscribe(listener: (now: number) => void): () => void {
  listeners.add(listener);
  if (timer == null) {
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l(now));
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useLiveFocusClock(active: boolean): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // 구독 시점에 즉시 현재 시각으로 올린다 — 멈춰 있던 화면이 다시 보일 때 값이 밀리지 않는다.
    setTick(Date.now());
    return subscribe(setTick);
  }, [active]);
  return tick;
}
