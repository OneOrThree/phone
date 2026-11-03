import { AppState, type AppStateStatus } from 'react-native';

/** 표시용 벽시계. 배경에서는 예약을 해제하고 복귀 때 현재 시각을 즉시 알린다. */
export function subscribeForegroundClock(onTick: (now: number) => void, intervalMs: number) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0)
    throw new RangeError('시계 간격은 양수여야 합니다.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const visible = (state: AppStateStatus) => state !== 'background' && state !== 'inactive';
  let active = visible(AppState.currentState);
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const arm = () => {
    if (disposed || !active) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        onTick(Date.now());
        arm();
      },
      intervalMs - (Date.now() % intervalMs),
    );
  };
  const subscription = AppState.addEventListener('change', (state) => {
    const next = visible(state);
    if (disposed || next === active) return;
    active = next;
    stop();
    if (active) {
      onTick(Date.now());
      arm();
    }
  });
  arm();
  return () => {
    disposed = true;
    stop();
    subscription.remove();
  };
}
