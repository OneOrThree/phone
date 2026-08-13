import { useEffect, useState } from 'react';

// 1초 공용 시계 — active 일 때만 1초 간격으로 now(ms epoch)를 갱신한다.
// 656(집중 세션 친구 그리드)·658(친구 탭 그리드)의 집중 라이브 틱업이 원래 용도고,
// 리그 마감 카운트다운(LeagueDeadline)도 같은 시계를 쓴다. active=false 면 인터벌을 돌리지 않는다.
//
// ⚠️ 타이머는 앱 전체에 **하나만** 둔다. 리그 랭킹은 행마다 이 훅을 부르는데(RankRow →
//    LiveFocusTime), 훅마다 setInterval 을 만들면 집중 중인 사람이 많을수록 타이머가 그대로
//    늘어난다 — 봇 190명(티켓 1565) 이후 최대 100개가 동시에 돌았다(GROMO-1572).
//    구독자가 모두 빠지면 타이머도 멈추므로, active=false 의 "인터벌을 안 돌린다"는 성질은 그대로다.
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(now: number) => void>();

function subscribe(listener: (now: number) => void): () => void {
  // 시계가 멈춰 있었으면 여기서 현재 시각으로 올린다 — 멈춘 동안의 공백을 첫 프레임에 메운다.
  if (timer == null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l(now));
    }, 1000);
  }
  listeners.add(listener);
  // ⚠️ 새 구독자에게 Date.now() 가 아니라 **공유값** now 를 준다(코덱스 리뷰). 이미 돌고 있는
  //    시계에 늦게 붙는 행(폴링으로 집중중이 된 행 등)이 제 시각을 따로 읽으면, 다음 틱까지
  //    최대 1초 동안 같은 목록의 행끼리 라이브 시간이 어긋난다. 늦게 붙은 쪽이 최대 1초 낡은
  //    값으로 시작하는 편이 목록 전체가 한 몸으로 흐르는 것보다 나쁘지 않다.
  listener(now);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useLiveFocusClock(active: boolean): number {
  // 시계가 이미 돌고 있으면 첫 렌더부터 공유값을 쓴다 — 구독(effect)은 페인트 뒤라, 여기서
  // 제 시각을 읽으면 그 한 프레임 동안만 다른 행과 값이 어긋난다.
  const [tick, setTick] = useState(() => (timer != null ? now : Date.now()));
  useEffect(() => {
    if (!active) return;
    // subscribe 가 구독 즉시 현재 공유값을 넘겨준다(멈춰 있었으면 현재 시각으로 올린 뒤).
    return subscribe(setTick);
  }, [active]);
  return tick;
}
