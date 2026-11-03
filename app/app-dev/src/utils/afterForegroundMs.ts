import { AppState } from 'react-native';

/** 포그라운드에 머문 시간만 누적한다. 반환한 함수로 타이머와 구독을 함께 해제한다. */
export const afterForegroundMs = (callback: () => void, durationMs: number) => {
  let remainingMs = durationMs;
  let startedAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const isForeground = (state: string | null) => state !== 'background' && state !== 'inactive';
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (startedAt !== null) {
      remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
      startedAt = null;
    }
  };
  const start = () => {
    if (stopped || timer || startedAt !== null) return;
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      startedAt = null;
      stopped = true;
      subscription.remove();
      callback();
    }, remainingMs);
  };
  const subscription = AppState.addEventListener('change', (state) => {
    if (isForeground(state)) start();
    else clear();
  });
  if (isForeground(AppState.currentState)) start();
  return () => {
    if (stopped) return;
    stopped = true;
    clear();
    subscription.remove();
  };
};
