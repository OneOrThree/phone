// dayChange.ts
// 로컬 날짜 경계(자정) 공유 신호 (GROMO-1006 코드리뷰 반영, 플랫폼 공통)
//
// SubjectContext·FocusContext처럼 '오늘' 기준 값을 들고 있는 스토어들이 같은 경계에서
// 함께 롤오버하도록 하나의 구독형 신호로 묶는다. 스토어마다 AppState 리스너만 두면
// 앱이 켜진 채(전환 없이) 자정을 넘겼을 때 한쪽만 갱신 계기를 받는 경로가 생긴다 —
// 예: 자정 후 과목 이름변경은 SubjectContext 저장 effect만 돌고 FocusContext는 신호가 없어
// 홈·통계 총합이 어제 값으로 남는다.
//
// 감지 경로 두 가지(둘 다 '날짜가 실제로 바뀐 것을 확인했을 때'만 콜백 호출):
// 1) 포그라운드 복귀(AppState active) — 백그라운드에서 자정을 넘긴 경우.
//    RN 타이머는 백그라운드에서 멈추지만 그 케이스는 이 검사가 커버한다.
// 2) 다음 로컬 자정 setTimeout — 앱이 활성 상태로 자정을 넘기는 경우. 발화 후 재예약.

import { AppState, type NativeEventSubscription } from 'react-native';
import { todayStr } from '@/utils/localDate';

type DayChangeCallback = () => void;

const callbacks = new Set<DayChangeCallback>();
let lastDay = todayStr();
let appStateSub: NativeEventSubscription | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;

function notifyIfDayChanged() {
  if (lastDay === todayStr()) return;
  lastDay = todayStr();
  callbacks.forEach((cb) => cb());
}

// 다음 로컬 자정(+5초 여유 — 발화 시점의 날짜 판정이 확실히 새날이 되게)으로 타이머 예약
function scheduleMidnightTimer() {
  if (midnightTimer) clearTimeout(midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  midnightTimer = setTimeout(() => {
    notifyIfDayChanged();
    scheduleMidnightTimer();
  }, next.getTime() - now.getTime());
}

function start() {
  lastDay = todayStr();
  appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active') notifyIfDayChanged();
  });
  scheduleMidnightTimer();
}

function stop() {
  appStateSub?.remove();
  appStateSub = null;
  if (midnightTimer) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}

// 날짜 경계 구독 — 첫 구독에서 감시를 시작하고 마지막 해제에서 정리한다. 해제 함수를 반환.
// 콜백(rolloverIfNeeded 류)은 자체적으로 날짜를 재검증하는 멱등 함수여야 한다.
export function subscribeDayChange(cb: DayChangeCallback): () => void {
  if (callbacks.size === 0) start();
  callbacks.add(cb);
  return () => {
    callbacks.delete(cb);
    if (callbacks.size === 0) stop();
  };
}
