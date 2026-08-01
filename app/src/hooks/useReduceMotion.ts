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

let enabled = false;
let nativeSub: { remove: () => void } | null = null;
const listeners = new Set<() => void>();

function setEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  listeners.forEach((notify) => notify());
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (listeners.size === 1) {
    // 첫 구독자에서만 현재값 조회 + 변경 구독을 시작한다
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setEnabled)
      .catch(() => {});
    nativeSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0) {
      nativeSub?.remove();
      nativeSub = null;
    }
  };
}

function getSnapshot(): boolean {
  return enabled;
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
