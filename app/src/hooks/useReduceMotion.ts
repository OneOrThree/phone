import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// 시스템 '동작 줄이기'(손쉬운 사용 › 동작) 상태를 **반응형으로** 읽는 훅.
//
// reanimated의 useReducedMotion()은 모듈 로드 시 1회 계산한 상수를 돌려주기 때문에
// (JSDoc에도 "설정을 바꿔도 리렌더되지 않는다"고 명시) 사용자가 설정을 켜도 앱을 완전히
// 종료·재실행하기 전까지 애니메이션이 계속 보인다. 그래서 AccessibilityInfo를 직접 구독한다.
//
// 구독은 모듈 단위로 1개만 두고 컴포넌트들이 같은 스냅샷을 공유한다 —
// 화면에 뜬 버튼 수만큼 네이티브 리스너가 붙는 걸 막는다.
//
// 초기값은 **미확정(null)** 에서 시작한다. RN은 이 설정의 동기 getter를 주지 않아
// isReduceMotionEnabled()가 resolve되기 전 구간이 존재하는데, 그 사이를 false(=애니메이션 켬)로
// 두면 '동작 줄이기'를 켠 사용자가 첫 탭에서 스케일 애니메이션을 보게 된다.
// 그래서 미확정 구간은 **보수적으로 '켜짐'** 으로 읽는다 — 첫 프레임 애니메이션을 잃는 쪽이
// 접근성 설정을 어기는 것보다 낫다.
// 또 네이티브 리스너는 한번 붙으면 떼지 않는다. 구독자가 0이 되는 사이에 설정이 바뀌면
// 다음 마운트에서 다시 비동기 조회가 끝날 때까지 낡은 값을 쓰게 되기 때문이다(리스너는 앱당 1개).

let enabled: boolean | null = null;
let initialized = false;
// 이벤트로 최신 값을 한 번이라도 받았는지. 초기 조회는 비동기라 그 사이에 온 이벤트보다
// **늦게** 완료될 수 있고, 그러면 낡은 조회 결과가 최신 설정을 덮어쓴다.
// 이벤트가 항상 더 최신이므로, 한 번 받은 뒤에는 초기 조회 응답을 폐기한다.
let observedFromEvent = false;
const listeners = new Set<() => void>();

function setEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((notify) => notify());
}

function onNativeChange(next: boolean): void {
  observedFromEvent = true;
  setEnabled(next);
}

function applyInitialQuery(next: boolean): void {
  // 이벤트가 이미 값을 확정했으면 뒤늦게 도착한 초기 조회는 버린다
  if (observedFromEvent) return;
  setEnabled(next);
}

function init(): void {
  if (initialized) return;
  initialized = true;
  // 조회보다 구독을 먼저 건다 — 조회가 도는 동안 바뀐 설정도 놓치지 않게
  AccessibilityInfo.addEventListener('reduceMotionChanged', onNativeChange);
  AccessibilityInfo.isReduceMotionEnabled()
    .then(applyInitialQuery)
    .catch(() => {
      // 조회 실패 시엔 미확정을 유지하지 않고 false로 확정한다 —
      // 값을 영영 못 읽는 기기에서 애니메이션이 통째로 사라지는 편이 더 나쁘다.
      // (이때도 이벤트로 받은 값이 있으면 그쪽이 우선)
      applyInitialQuery(false);
    });
}

function subscribe(onStoreChange: () => void): () => void {
  init();
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): boolean | null {
  return enabled;
}

export function useReduceMotion(): boolean {
  // null(미확정) → true: 확정 전에는 애니메이션을 생략한다
  return useSyncExternalStore(subscribe, getSnapshot) ?? true;
}

/**
 * '동작 줄이기' 값이 **확정됐는가**. 초기 비동기 조회가 끝나기 전에는 false.
 *
 * ⚠️ `useReduceMotion()`은 미확정 구간을 보수적으로 `true`로 읽는다(그게 옳다 — 설정을 켠
 *    사용자가 첫 프레임 애니메이션을 보는 것보다 낫다). 그런데 그 `true`를 **실제 설정처럼**
 *    써서 되돌릴 수 없는 결정을 내리면 안 된다. 예: 단계 시퀀스의 대기 시간을 0으로 만들어
 *    시작해 버리면, 설정을 켜지 않은 사용자도 연출을 통째로 잃는다(codex 리뷰).
 *    "지금 이 값으로 시작해도 되는가"를 물어야 하는 곳에서 이 훅을 쓴다.
 */
export function useReduceMotionReady(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot) !== null;
}
